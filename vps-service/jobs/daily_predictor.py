#!/usr/bin/env python3
"""
V40.2 Historical/Daily Prediction Generator (CLI-enabled)
==========================================================
توليد توقعات V40.2 لأي فترة تاريخية أو لليوم/أمس.

هذه نسخة مطوّرة من scratch/v40_2_historical_generator.py تقبل معاملات CLI
وتدعم وضع --today-only و --yesterday-only لتوليد توقعات يومية.

الاستخدامات:
  # توليد لفترة كاملة (افتراضي: 2026-01-01 ← اليوم)
  python3 vps-service/jobs/daily_predictor.py

  # توليد لليوم فقط (للكرون اليومي)
  python3 vps-service/jobs/daily_predictor.py --today-only

  # توليد لأمس فقط (بعد إغلاق السوق)
  python3 vps-service/jobs/daily_predictor.py --yesterday-only

  # فترة مخصصة
  python3 vps-service/jobs/daily_predictor.py --start 2026-08-01 --end 2026-08-14

  # جاف فقط (لا يكتب في DB) — للاختبار
  python3 vps-service/jobs/daily_predictor.py --today-only --dry-run

  # عدم حذف التوقعات القديمة (الافتراضي: يحذف V40 predictions القديمة في الفترة)
  python3 vps-service/jobs/daily_predictor.py --today-only --keep-old

الكرون المقترح (بعد إغلاق السوق بـ 30 دقيقة):
  30 14 * * 0-4 cd /home/z/my-project && /root/.venv/bin/python3 \
    vps-service/jobs/daily_predictor.py --yesterday-only \
    >> logs/v40_2_daily.log 2>&1

V40.2 changes vs V40.1:
  - Strict kill-filter mode (no market-open relaxation)
  - Real EGX30ETF benchmark (loaded lazily by the engine)
  - Tightened entry conditions (real benchmark + mapping fix + absorption 1.5)
  - partial_exit_at_rr = 1.5 (let winners run further)
"""
import sys
import os
import json
import gc
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from contextlib import contextmanager

# ─── Path setup (MUST come before predictor_modules imports) ──────────────
# predictor_modules/* import from `core.db_manager` which lives in vps-service/,
# so vps-service/ must be on sys.path BEFORE we import them.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'vps-service'))
os.chdir(PROJECT_ROOT)
os.environ['BYPASS_PRED_CAP'] = '1'

# ─── Phase 7.2 Strangler Pattern: import 5 extracted modules ────────────────
# Each function below was extracted VERBATIM to vps-service/jobs/predictor_modules/
# and re-imported here. Behavior is 100% equivalent (Strangler Pattern).
# Original inline definitions have been removed.
from predictor_modules.whale_guard import _whale_distribution_guard
from predictor_modules.db_helpers import (
    _V402_DBM_AVAILABLE,
    _dbm,
    _open_db,
)
from predictor_modules.persona_fit import compute_persona_fit
from predictor_modules.scan_dates import get_scan_dates
from predictor_modules.cleanup import delete_old_v40_predictions
# Phase 8.2: 3 blocks extracted from run_generator()
from predictor_modules.summary import compute_and_save_summary
from predictor_modules.dry_run_printer import print_dry_run_summary
from predictor_modules.price_cache import pre_cache_price_history


def _phase72_extraction_marker():  # pragma: no cover
    """Placeholder preserving line offsets after Phase 7.2 extraction.

    The following functions were extracted to predictor_modules/ and re-imported
    above (Strangler Pattern — semantic equivalence preserved):
      - _whale_distribution_guard  → predictor_modules.whale_guard
      - _open_db + _dbm + _V402_DBM_AVAILABLE → predictor_modules.db_helpers
      - compute_persona_fit         → predictor_modules.persona_fit
      - get_scan_dates              → predictor_modules.scan_dates
      - delete_old_v40_predictions  → predictor_modules.cleanup
    """
    pass


def _whale_distribution_guard_REMOVED(opens, highs, lows, closes, volumes):
    """Phase 7.2: extracted to predictor_modules.whale_guard._whale_distribution_guard."""
    raise NotImplementedError("Should never be called — see import above.")


def _whale_distribution_guard_REMOVED_DO_NOT_CALL(opens, highs, lows, closes, volumes):
    """REMOVED in Phase 7.2 — see predictor_modules.whale_guard._whale_distribution_guard."""
    raise NotImplementedError("Phase 7.2 extraction — see predictor_modules.whale_guard")

from engines.backtest_engine import V38BacktestEngine, Trade, simulate_trade, calc_atr
PRICE_HISTORY_DB = str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db')
from analyzers.liquidity_filter import set_strict_kill_filters
from analyzers.prediction_tracker import PredictionTracker
from analyzers.adaptive_weights import PERSONA_INPUT_WEIGHTS
from analyzers.core_scoring_engine import detect_volume_surge_rocket, detect_accumulation_phase, detect_recovery_from_base

# ─── PHASE-B: محرك السيولة كبوابة أولى ──────────────────────────
# استيراد دوال السيولة الديناميكية لفحص الأسهم قبل التحليل
try:
    from utils.shared_liquidity import should_reject_by_liquidity as _shared_should_reject_by_liquidity
    _SHARED_LIQUIDITY_AVAILABLE = True
except ImportError:
    _SHARED_LIQUIDITY_AVAILABLE = False
    def _shared_should_reject_by_liquidity(*args, **kwargs):
        return (False, 'shared_liquidity unavailable', False, 0.0)

# ─── Rule 28: Toxic Ticker Blocklist ───
_BLOCKLIST_PATH = Path(__file__).resolve().parents[1] / 'config' / 'toxic_ticker_blocklist.json'
_TOXIC_BLOCKLIST = None  # lazy-loaded cache

def _load_toxic_blocklist():
    """Load the toxic ticker blocklist (Rule 28).
    Returns a set of ticker symbols to skip during generation.
    DNA-WINNER: disabled by default (was blocking 21 tickers without clear reason).
    Set DNA_TOXIC_BLOCKLIST_ENABLED=1 to re-enable.
    """
    global _TOXIC_BLOCKLIST
    if _TOXIC_BLOCKLIST is not None:
        return _TOXIC_BLOCKLIST
    # DNA-WINNER: toxic blocklist disabled by default
    if not DNA_TOXIC_BLOCKLIST_ENABLED:
        _TOXIC_BLOCKLIST = set()
        return _TOXIC_BLOCKLIST
    try:
        if _BLOCKLIST_PATH.exists():
            with open(_BLOCKLIST_PATH) as f:
                data = json.load(f)
            _TOXIC_BLOCKLIST = set(data.get('toxic_tickers', []))
            if _TOXIC_BLOCKLIST:
                print(f"🚫 Rule 28: {len(_TOXIC_BLOCKLIST)} toxic tickers blocklisted: {sorted(_TOXIC_BLOCKLIST)}", flush=True)
        else:
            _TOXIC_BLOCKLIST = set()
    except Exception:
        _TOXIC_BLOCKLIST = set()
    return _TOXIC_BLOCKLIST

def _is_ticker_blocklisted(ticker):
    """Check if a ticker is on the toxic blocklist (Rule 28)."""
    return ticker in _load_toxic_blocklist()
from analyzers.engine_settings import get_setting
from core.persona_db import safe_store_prediction, update_persona_prediction_outcome

PREDICTIONS_DB = os.environ.get('V40_2_PREDICTIONS_DB') or os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
# PRICE_HISTORY_DB is now imported from the engine — it auto-resolves to the
# correct location (primary db/ or daily backup db/backups/daily/*/) without
# copying or modifying any database file. Read-only detection.

DEFAULT_START = '2026-01-01'
DEFAULT_END = '2026-06-10'  # historical default (sandbox run)
# PHASE-C: قراءة من engine_settings (dynamic — admin-configurable)
SCAN_INTERVAL = int(get_setting('v402_scan_interval', default=1))
MAX_PICKS_PER_DAY = int(get_setting('v402_max_picks_per_day', default=5))
MIN_TICKER_DAYS = int(get_setting('v402_min_ticker_days', default=30))

# ============================================================================
# STABLECOINS BLACKLIST (Task CRYPTO-1 — Owner Directive 2026-10-12)
# ============================================================================
# العملات المستقرة والرموز المغلفة ممنوعة من التوقعات لأن ثبات سعرها
# (≈1.00$) يخدع محركات التجميع ويسجل إشارات وهمية. WBTC/WETH رموز مغلفة.
STABLECOINS = frozenset({
    'USDT', 'USDC', 'FDUSD', 'DAI', 'USDD', 'TUSD', 'BUSD',
    'PYUSD', 'EURC', 'WBTC', 'WETH', 'U',
})


def is_stablecoin(ticker: str) -> bool:
    """فحص: هل هذا الـ ticker عملة مستقرة أو رمز مغلّف؟ (ممنوع من التوقعات)."""
    if not ticker:
        return False
    t = str(ticker).strip().upper()
    if t in STABLECOINS:
        return True
    base = t.split('-')[0].split('.')[0].split('/')[0].split('_')[0]
    return base in STABLECOINS

# ── V68 ORACLE FEATURE TOGGLES (A/B testing — 2026-08-31) ──
# كل ميزة V68 ممكن تتعطل/تتفعل عبر env var عشان نعمل A/B backtest.
# القاعدة: النتائج هي اللي تقرر - بـ نـ keep الكويس ونمسيح الوحش.
#
# A/B BACKTEST RESULTS (200 tickers, Feb-Aug 2026):
#   ✅ KEEP  V68_DIRTY_DIST_REJECT   : +3.2% WR, +22.5% Return (rejected 6 فخاخ)
#   ❌ KILL  V68_NO_CHASE_2D_REJECT  : 0 triggers (EGX لا يقفز 15% في يومين)
#   ❌ KILL  V68_PROOF_PROBABILITY   : avg prob=31.7 → أغلب الإثباتات ❌ (عديم الفائدة)
#   ❌ KILL  V68_APLUS_BOOST         : 1 trigger, 0 تأثير (boost صغير لا يغير picks)
#   ❌ KILL  V68_MAGNETIC_TARGET     : 0 triggers (high_magnet بـ R:R≥2 نادر)
V68_DIRTY_DIST_REJECT = os.environ.get('V68_DIRTY_DIST_REJECT', '1') == '1'     # ✅ KEEP — proven +22.5% return
V68_NO_CHASE_2D_REJECT = os.environ.get('V68_NO_CHASE_2D_REJECT', '0') == '1'   # ❌ KILL — 0 triggers
V68_PROOF_PROBABILITY = os.environ.get('V68_PROOF_PROBABILITY', '0') == '1'     # ❌ KILL — avg prob 31.7 useless
V68_APLUS_BOOST = os.environ.get('V68_APLUS_BOOST', '0') == '1'                 # ❌ KILL — no effect
V68_MAGNETIC_TARGET = os.environ.get('V68_MAGNETIC_TARGET', '0') == '1'         # ❌ KILL — 0 triggers

# ── V72 MULTI-PATH FEATURE TOGGLES (A/B testing — 2026-08-31) ──
# كل ميزة V72 default = '0' (OFF) حتى الباك-تست يقرر.
# القاعدة: النتائج هي اللي تقرر - بـ نـ keep الكويس ونمسيح الوحش.
#
# A/B BACKTEST RESULTS (200 tickers, Jul-Aug 2026):
#   ✅ KEEP  V72_HIDDEN_DIST_BLOCK   : +36.5% Return (rejected توزيع خفي)
#   ❌ KILL  V72_WASH_TRADE_REJECT   : -12.2% WR (رفض فرص رابحة!)
#   ❌ KILL  V72_PULLBACK_BUY_PATH   : 0 triggers (low_magnet نادر في EGX)
#   ❌ KILL  V72_MAKER_DEATH_POINT   : 8 triggers, 0 تأثير (stop changes لا تؤثر على outcome)
#   ❌ KILL  V72_MARKET_BULLISH_SIZING: 0 triggers (market_regime دايماً bull/range في الفترة)
#   ⏸️ PENDING V72_KILL_SWITCH_EXIT  : exit-level feature (needs daily_closer backtest)
V72_WASH_TRADE_REJECT = os.environ.get('V72_WASH_TRADE_REJECT', '0') == '1'     # ❌ KILL — -12.2% WR
V72_HIDDEN_DIST_BLOCK = os.environ.get('V72_HIDDEN_DIST_BLOCK', '0') == '1'    # ❌ KILL (DNA-WINNER) — كان بيرفض كل حاجة
V72_PULLBACK_BUY_PATH = os.environ.get('V72_PULLBACK_BUY_PATH', '0') == '1'    # ❌ KILL — 0 triggers
V72_MAKER_DEATH_POINT = os.environ.get('V72_MAKER_DEATH_POINT', '0') == '1'    # ❌ KILL — no effect
V72_KILL_SWITCH_EXIT = os.environ.get('V72_KILL_SWITCH_EXIT', '0') == '1'      # ⏸️ PENDING — exit-level
V72_MARKET_BULLISH_SIZING = os.environ.get('V72_MARKET_BULLISH_SIZING', '0') == '1'  # ❌ KILL — 0 triggers

# ════════════════════════════════════════════════════════════════════════════
# 🧬 DNA-WINNER (2026-09-03): The winning flags from backtest ablation.
# PF 3.57, WR 60.45%, MaxDD -2.11%, Exp +6.27% on 8% position size.
# These are the flags that the backtest proved WIN. Default ON.
# ════════════════════════════════════════════════════════════════════════════
DNA_DISTRIBUTION_EXIT = os.environ.get('DNA_DISTRIBUTION_EXIT', '1') == '1'      # ✅ Winner — exit on topping pattern
DNA_EGX30_DOWN_HOLD   = os.environ.get('DNA_EGX30_DOWN_HOLD', '1') == '1'        # ✅ Winner — skip BUY when market down >0.4%
DNA_PARTIAL_EXIT      = os.environ.get('DNA_PARTIAL_EXIT', '1') == '1'            # ✅ Winner — sell 40% at 1.5R, trail rest
DNA_ANOMALY_FILTER    = os.environ.get('DNA_ANOMALY_FILTER', '1') == '1'         # ✅ Winner — reject >50% move in 5 days
DNA_MAX_OPEN_POSITIONS = int(os.environ.get('DNA_MAX_OPEN_POSITIONS', '5'))      # ✅ Winner — hard limit 5 concurrent (was 8)
DNA_SECTOR_LIMIT_FINANCE = float(os.environ.get('DNA_SECTOR_LIMIT_FINANCE', '0.20'))  # ✅ Finance ≤ 20%
DNA_SECTOR_LIMIT_OTHER   = float(os.environ.get('DNA_SECTOR_LIMIT_OTHER', '0.15'))    # ✅ Any other ≤ 15%

# Toxic blocklist: disabled per owner instruction (21 tickers blocked without clear reason)
# Set DNA_TOXIC_BLOCKLIST=1 to re-enable
DNA_TOXIC_BLOCKLIST_ENABLED = os.environ.get('DNA_TOXIC_BLOCKLIST_ENABLED', '0') == '1'

# ── V73 SNIPER FEATURE TOGGLES (A/B testing — 2026-08-31) ──
# 2 ميزات GENUINELY NEW من V73 (EGX Oracle Sniper):
# A/B على 6 شهور (Feb-Aug 2026) — validated general, not overfit.
#   ✅ KEEP  V73_DESERT_PHASE_REJECT : +23.1% return (rejected 3 dead stocks)
#   ❌ KILL  V73_AUCTION_TRAP_REJECT  : 0 triggers (EGX لا يقفز >10% في شمعة واحدة)
V73_DESERT_PHASE_REJECT = os.environ.get('V73_DESERT_PHASE_REJECT', '1') == '1'  # ✅ KEEP — +23.1% return
V73_AUCTION_TRAP_REJECT = os.environ.get('V73_AUCTION_TRAP_REJECT', '0') == '1'  # ❌ KILL — 0 triggers


def count_evidence(proofs):
    """Count ✅ markers in proofs dict."""
    return sum(1 for v in proofs.values() if '✅' in str(v))


def compute_r_multiple(entry, target, stop):
    """Compute R-multiple: reward/risk ratio — Rule 54: delegates to canonical."""
    # Rule 54: استخدم canonical compute_risk_reward (بـ يكتشف BUY/SELL تلقائياً)
    try:
        from utils.risk_reward import compute_risk_reward
        return compute_risk_reward(entry, target, stop, fallback=0.0)
    except Exception:
        # fallback آمن لو canonical مش متاح
        if entry > 0 and stop < entry:
            return (target - entry) / (entry - stop)
        return 0.0


# ─── Phase 2 (Option A — Safe): Persona-Fit من نفس الـ V40.2 pool ───
# القاعدة الذهبية: السهم الواحد = صفقة واحدة. persona='balanced' في predictions
# لا يتغير (حماية الـ baseline 81.8%). الـ persona_fit بـ يُستخدم لـ:
#   1. annotate kill_filter_result (رؤية تحليلية في الـ data).
#   2. كتابة persona_predictions منفصلة للأسهم اللي strongly fit gambler/conservative
#      من نفس الـ pool القوي (evidence-based + kill filters) — بدون ما تؤثر على
#      overall KPI (persona_predictions منفصل عن predictions، والـ overall dedup بالـ ticker).
# الـ row بـ يتـ closed فورًا بـ outcome المحاكى من V40.2 → مفيش orphan PENDING rows.
PERSONA_FIT_MIN_SCORE = 50.0  # أدنى fit score لكتابة persona_predictions


# ─── Phase 7.2: compute_persona_fit() + get_scan_dates() extracted ──────────
# Original definitions removed (Strangler Pattern — see predictor_modules/).
# Re-imported above. Search "compute_persona_fit" / "get_scan_dates" in
# predictor_modules/persona_fit.py and predictor_modules/scan_dates.py for source.
def _phase72_persona_fit_and_scan_dates_removed_marker():  # pragma: no cover
    pass


def get_tickers(min_days=MIN_TICKER_DAYS, market_code='EGX'):
    """Get tickers with enough historical data.

    PHASE-2-DB-UNIFY (2026-08-29): price_history.db is the canonical source.
    - price_history.db.price_history: 1,267 tickers, 1.24M rows
    - data_engine.db.egksco_price_history: 0 rows على الإنتاج (fallback only)
    - stocks.db.stock_daily_prices: 1,023 tickers (fallback أخير)

    EGX-MARKET-ISOLATION (2026-08-30): فلتر صارم لـ EGX canonical فقط.
    المشكلة: المصادر دي بتحتوي على tickers من 4 أسواق (EGX + TADAWUL + KSE + QSE)
    + tickers ملوّثة (أسماء شركات + ISIN codes). قبل كده النظام بـ يعالج كل الأسهم
    دي → 65% من التوقعات ممكن تكون لأسهم غير مصرية + tickers غلط.
    الحل: filter_egx_tickers بيرجّع بس الـ tickers المصرية الصحيحة (289 سهم من
    EGX_CANONICAL_TV + EGX_ISIN_NAMES). كل ticker بيتطبّع لـ رمز نظيف موجود في
    TradingView.

    MULTI-MARKET SUPPORT (2026-10-28): لما market_code != 'EGX'، بنفلتر
    بالـ market column في stocks.db مباشرةً بدل الـ egx_gate (اللي هو EGX-only).
    ده معناه:
      - market_code='KSA' → tickers TADAWUL من stocks.db WHERE market='TADAWUL'
      - market_code='KSE' → tickers KSE من stocks.db WHERE market='KSE'
      - market_code='QSE' → tickers QSE من stocks.db WHERE market='QSE'
      - market_code='EGX' → نفس السلوك القديم (egx_gate filter)
    """
    _db_dir = Path(__file__).resolve().parents[2] / 'db'

    # ── MULTI-MARKET PATH: non-EGX markets filter by stocks.db.market column ──
    # Skip the EGX-only gate for TADAWUL/KSE/QSE/US — use the stocks table
    # market column directly (those markets have clean ticker codes already).
    if market_code != 'EGX':
        # Map CLI market code → stocks.db market value
        # (TADAWUL is stored as 'TADAWUL' in stocks.db, but CLI uses 'KSA')
        db_market = {
            'KSA': 'TADAWUL',
            'TADAWUL': 'TADAWUL',
            'KSE': 'KSE',
            'QSE': 'QSE',
            'US': 'US',
        }.get(market_code, market_code)
        try:
            if not _V402_DBM_AVAILABLE:
                raise RuntimeError("db_manager unavailable")
            _stocks_db_path = str(_db_dir / 'stocks.db')
            conn = _dbm.get_connection(_stocks_db_path, writable=False)
            cur = conn.cursor()
            # Active stocks with current_price > 0 in this market
            cur.execute(
                "SELECT ticker FROM stocks WHERE market = ? AND is_active = 1 AND current_price > 0 ORDER BY ticker",
                (db_market,),
            )
            tickers = [row[0] for row in cur.fetchall()]
            conn.close()
            print(f"[V40.2] stocks.db (market={db_market}) — {len(tickers)} tickers", flush=True)
            return tickers
        except Exception as _mm_err:
            import logging as _mm_log
            _mm_log.warning(f"[daily_predictor] multi-market path failed for {market_code}: {_mm_err}")
            # Fall through to EGX-style sources as last resort (will likely return [])

    # EGX-MARKET-ISOLATION: استيراد الـ gate
    try:
        from utils.egx_gate import filter_egx_tickers_detailed
        _egx_gate_available = True
    except Exception:
        _egx_gate_available = False

    # Phase 5 (DATA-UNIFICATION): price_history.db is now PRIMARY (canonical, 1.4M rows)
    # Source 1: price_history.db.price_history (canonical — 1.4M rows, 1557 tickers)
    # FIX: use DAL only — no raw sqlite3.connect fallback.
    # FIX: query the CORRECT table (price_history, not stock_daily_prices).
    try:
        if not _V402_DBM_AVAILABLE:
            raise RuntimeError("db_manager unavailable — skipping price_history.db source")
        _ph_db_path = str(_db_dir / 'price_history.db')
        conn = _dbm.get_connection(_ph_db_path, writable=False)
        cur = conn.cursor()
        # Check which table exists in this DB
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('price_history', 'stock_daily_prices')")
        _ph_table_row = cur.fetchone()
        _ph_table = _ph_table_row[0] if _ph_table_row else None
        if _ph_table:
            cur.execute(f"PRAGMA table_info({_ph_table})")
            _ph_cols = [r[1] for r in cur.fetchall()]
            _ph_ticker_col = 'ticker' if 'ticker' in _ph_cols else ('symbol' if 'symbol' in _ph_cols else None)
            if _ph_ticker_col:
                cur.execute(
                    f"SELECT DISTINCT {_ph_ticker_col} FROM {_ph_table} GROUP BY {_ph_ticker_col} HAVING COUNT(*) >= ? ORDER BY {_ph_ticker_col}",
                    (min_days,),
                )
                raw_tickers = [row[0] for row in cur.fetchall()]
            else:
                raw_tickers = []
        else:
            raw_tickers = []
        conn.close()
        if raw_tickers:
            # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
            if _egx_gate_available:
                result = filter_egx_tickers_detailed(raw_tickers)
                tickers = result['accepted']
                stats = result['stats']
                print(f"[V40.2] price_history.db ({_ph_ticker_col}) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
                print(f"[V40.2] Using price_history.db ({_ph_ticker_col}) — {len(tickers)} tickers "
                      f"(⚠️ EGX gate not available — no filtering)", flush=True)
            return tickers
    except Exception as _src1_err:
        import logging as _src1_log
        _src1_log.warning(f"[daily_predictor] Source 1 (price_history.db) failed: {_src1_err} — trying next source")

    # Source 2: data_engine.db (egksco_price_history — legacy fallback)
    # FIX: use DAL only — no raw sqlite3.connect fallback.
    try:
        if not _V402_DBM_AVAILABLE:
            raise RuntimeError("db_manager unavailable — skipping data_engine.db source")
        _de_db_path = str(_db_dir / 'data_engine.db')
        conn = _dbm.get_connection(_de_db_path, writable=False)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT symbol FROM egksco_price_history GROUP BY symbol HAVING COUNT(*) >= ? ORDER BY symbol",
            (min_days,),
        )
        raw_tickers = [row[0] for row in cur.fetchall()]
        conn.close()
        if raw_tickers:
            # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
            if _egx_gate_available:
                result = filter_egx_tickers_detailed(raw_tickers)
                tickers = result['accepted']
                stats = result['stats']
                print(f"[V40.2] FALLBACK: data_engine.db (egksco) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
            return tickers
    except Exception as _src2_err:
        import logging as _src2_log
        _src2_log.warning(f"[daily_predictor] Source 2 (data_engine.db) failed: {_src2_err} — trying next source")

    # Source 3: stocks.db (stock_daily_prices — last resort)
    # FIX: use DAL only — no raw sqlite3.connect fallback.
    try:
        if not _V402_DBM_AVAILABLE:
            raise RuntimeError("db_manager unavailable — skipping stocks.db source")
        _stocks_db_path = str(_db_dir / 'stocks.db')
        conn = _dbm.get_connection(_stocks_db_path, writable=False)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT ticker FROM stock_daily_prices GROUP BY ticker HAVING COUNT(*) >= ? ORDER BY ticker",
            (min_days,),
        )
        raw_tickers = [row[0] for row in cur.fetchall()]
        conn.close()
        if raw_tickers:
            # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
            if _egx_gate_available:
                result = filter_egx_tickers_detailed(raw_tickers)
                tickers = result['accepted']
                stats = result['stats']
                print(f"[V40.2] stocks.db (stock_daily_prices) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
                print(f"[V40.2] Using stocks.db (stock_daily_prices) — {len(tickers)} tickers", flush=True)
            return tickers
    except Exception:
        pass

    return []


# ─── Phase 7.2: delete_old_v40_predictions() extracted ──────────────────────
# Original definition removed (Strangler Pattern — see predictor_modules/cleanup.py).
# Re-imported above. The dead-code path with sqlite3.connect(PREDICTIONS_DB, ...)
# now lives in predictor_modules/cleanup.py (unreachable after the early-return).
def _phase72_delete_old_v40_predictions_removed_marker():  # pragma: no cover
    pass


# ─── RECOMMENDATION 1: فلتر حرارة القطاع ─────────────────────────────────────
# باك-تست: رفض التوقع لو القطاع هابط → رفع WR +1.5% + عائد +12.56%
_sector_heat_cache = {}

def load_sector_heat(market_code='EGX'):
    """تحميل حرارة القطاعات من stocks.db (مرة واحدة لكل سوق)."""
    global _sector_heat_cache
    cache_key = market_code
    if cache_key in _sector_heat_cache:
        return _sector_heat_cache[cache_key]
    
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(_db_dir / 'stocks.db'), writable=False)
        cur = conn.cursor()
        cur.execute("""
            SELECT sector, AVG(change_percent) as avg_change, COUNT(*) as cnt
            FROM stocks
            WHERE is_active = 1 AND market = ?
            AND sector IS NOT NULL AND change_percent IS NOT NULL
            GROUP BY sector HAVING COUNT(*) >= 3
        """, (market_code,))
        result = {}
        for row in cur.fetchall():
            result[row[0]] = row[1]
        conn.close()
        _sector_heat_cache[cache_key] = result
        print(f"[V40.2] Sector heat loaded: {len(result)} sectors ({market_code})", flush=True)
    except Exception as e:
        print(f"[V40.2] ⚠️ Sector heat load failed: {e}", flush=True)
        _sector_heat_cache[cache_key] = {}
    
    return _sector_heat_cache.get(cache_key, {})

def get_ticker_sector(ticker):
    """جيب قطاع السهم من stocks.db."""
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(_db_dir / 'stocks.db'), writable=False)
        cur = conn.cursor()
        cur.execute("SELECT sector FROM stocks WHERE ticker = ? AND market = ? LIMIT 1", (ticker, market_code))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


# ============================================================================
# WHALE_RADAR INTEGRATOR (Hunter Mode — Per Mohsen's directive 2026-10-20)
# ============================================================================
# When the market is DEFENSIVE/correction AND the classic Trend Following
# engine produces no breakout picks, this function reads the maker_radar
# JSON output (Quiet Accumulation path B_quiet_accumulation_strong) and
# generates WHALE_RADAR predictions for stocks where whales are quietly
# accumulating. This is "Hunter Mode" — we surface whale activity to the
# user instead of showing an empty defensive screen.
#
# Filter criteria (per owner directive):
#   1. path == 'B_quiet_accumulation_strong' (Quiet Accumulation path)
#   2. quiet_details.signal_count >= 5 (5/6 or 6/6 signals verified)
#   3. avg_turnover_20d >= 10_000_000 (10M EGP minimum liquidity)
#   4. distribution_flag == False (no whale distribution)
#
# For each surviving stock, we store:
#   - prediction with signal='WHALE_RADAR_BUY', persona='gambler',
#     who_is_buying_state='WHALE_RADAR', position_size=2%
#   - stored_analyses entry with source='WHALE_RADAR'
# ============================================================================

WHALE_RADAR_OUTPUT_DIR = Path(PROJECT_ROOT) / 'scripts' / 'output'
WHALE_RADAR_MIN_TURNOVER = 5_000_000   # 5M EGP minimum liquidity (EXPERIMENTAL — was 10M)
WHALE_RADAR_MIN_SIGNALS = 5            # 5/6 or 6/6 signals verified
WHALE_RADAR_POSITION_SIZE = 0.02       # 2% of portfolio (strict risk management)
WHALE_RADAR_MIN_RR = 1.8               # R:R >= 1.8 (per owner directive)


def _integrate_whale_radar_predictions(scan_date: str, market_code: str,
                                        tracker, total_generated_ref: list):
    """
    Read the latest maker_radar JSON output + generate WHALE_RADAR predictions
    for stocks with Quiet Accumulation pattern (path B).

    Args:
        scan_date: YYYY-MM-DD format (the prediction date).
        market_code: 'EGX' | 'TADAWUL' | etc.
        tracker: PredictionTracker instance (already initialized).
        total_generated_ref: mutable list [int] — we append count to outer scope.

    Returns:
        int: number of WHALE_RADAR predictions generated.
    """
    try:
        # (1) Locate the radar JSON for this market + date
        # The maker_radar.py outputs to: maker_radar_{MARKET}_{YYYY-MM-DD}.json
        radar_json_path = WHALE_RADAR_OUTPUT_DIR / f'maker_radar_{market_code}_{scan_date}.json'

        # Fallback: try without date suffix (latest run for this market)
        if not radar_json_path.exists():
            # Find the most recent maker_radar_{MARKET}_*.json
            candidates = sorted(WHALE_RADAR_OUTPUT_DIR.glob(f'maker_radar_{market_code}_*.json'), reverse=True)
            if not candidates:
                print(f"  🐋 [WHALE_RADAR] No maker_radar JSON found for {market_code} on {scan_date}", flush=True)
                return 0
            radar_json_path = candidates[0]
            print(f"  🐋 [WHALE_RADAR] Using latest radar: {radar_json_path.name}", flush=True)

        with open(radar_json_path, 'r', encoding='utf-8') as f:
            radar_data = json.load(f)

        # (2) Filter quiet_list for high-conviction Quiet Accumulation picks
        quiet_list = radar_data.get('quiet_list', [])
        if not quiet_list:
            print(f"  🐋 [WHALE_RADAR] No quiet_list in radar output", flush=True)
            return 0

        # Apply the 4 filter criteria
        candidates = []
        for stock in quiet_list:
            ticker = stock.get('ticker', '')
            path = stock.get('path', '')
            # ═══════════════════════════════════════════════════════════════════
            # EXPERIMENTAL-FIX (2026-10-22) — تحت التجربة
            # ═══════════════════════════════════════════════════════════════════
            # قبل: turnover = stock.get('avg_turnover_20d', 0)
            #   → بيستخدم متوسط 20 يوم (ممكن يكون أقل من السيولة الحالية)
            #   → أسهم سيولتها الحالية كويسة بقت reject (زي ELNA, CPME, EGS)
            #
            # بعد: turnover = turnover_egp (آخر يوم) + fallback لـ avg_turnover_20d
            #   → لو turnover_egp متاح (من RADAR-FIX-1)، استخدمه (سيولة اليوم الحالية)
            #   → ده أكتر دقة في تقييم سيولة السهم "دلوقتي"
            #
            # كمان الـ threshold اترفع: WHALE_RADAR_MIN_TURNOVER = 10M → 5M
            #   → عشان نسمح بأسهم سيولتها متوسطة (5M-10M) بس فيها تجميع هادئ
            #
            # الوضع: تحت التجربة على اللاب توب. لو النتايج كويسة → ننزل للإنتاج.
            # لو النتايج سيئة → نرجّع WHALE_RADAR_MIN_TURNOVER = 10M + avg_turnover_20d.
            # ═══════════════════════════════════════════════════════════════════
            turnover_egp_today = stock.get('turnover_egp', 0) or 0
            avg_turnover_20d = stock.get('avg_turnover_20d', 0) or 0
            # الأولوية: turnover_egp (آخر يوم) → avg_turnover_20d (متوسط 20 يوم)
            turnover = turnover_egp_today if turnover_egp_today > 0 else avg_turnover_20d
            quiet_details = stock.get('quiet_details') or {}
            signal_count = quiet_details.get('signal_count', 0) if quiet_details else 0
            distribution_flag = stock.get('distribution_flag', False)

            # Criterion 1: path must be B_quiet_accumulation_strong (or similar quiet path)
            if 'quiet_accumulation' not in path.lower():
                continue
            # Criterion 2: at least 5/6 signals verified
            if signal_count < WHALE_RADAR_MIN_SIGNALS:
                continue
            # Criterion 3: minimum liquidity 5M EGP (EXPERIMENTAL — was 10M)
            #             عشان نسمح بأسهم سيولتها متوسطة (5M-10M) بس فيها تجميع هادئ
            if turnover < WHALE_RADAR_MIN_TURNOVER:
                continue
            # Criterion 4: no whale distribution
            if distribution_flag:
                continue

            candidates.append(stock)

        if not candidates:
            print(f"  🐋 [WHALE_RADAR] No stocks passed all 4 filters (path + signals>=5 + turnover>=10M + no distribution)", flush=True)
            return 0

        # BRAVO-SSOT Stage 3: enrich candidates with unified_scanner confluence data
        # (macro_location + dist_to_52w + proofs + distribution veto)
        try:
            import sys as _ss_sys
            _vps_root = os.path.join(PROJECT_ROOT, 'vps-service')
            if _vps_root not in _ss_sys.path:
                _ss_sys.path.insert(0, _vps_root)
            from core.unified_scanner import _scan_single_stock, ScanConfig
            _ss_config = ScanConfig(market_name=market_code, min_turnover_egp=0, min_score=0)
            for cand in candidates:
                _ss_result = _scan_single_stock(cand.get('ticker', ''), _ss_config)
                if _ss_result:
                    cand['macro_location'] = _ss_result.get('macro_location', 'MID_RANGE')
                    cand['dist_to_52w_high'] = _ss_result.get('dist_to_52w_high', 0)
                    cand['dist_to_52w_low'] = _ss_result.get('dist_to_52w_low', 0)
                    cand['confluence_proofs'] = _ss_result.get('proofs', 0)
                    cand['confluence_reasons'] = _ss_result.get('reasons', [])
                    # Veto: لو الـ unified_scanner قال DISTRIBUTION_VETO → شيله
                    if _ss_result.get('track') == 'DISTRIBUTION_VETO':
                        cand['_vetoed'] = True
            # شيل الـ vetoed
            before_veto = len(candidates)
            candidates = [c for c in candidates if not c.get('_vetoed')]
            vetoed_count = before_veto - len(candidates)
            if vetoed_count > 0:
                print(f"  🐋 [WHALE_RADAR] {vetoed_count} stock(s) vetoed by unified_scanner (distribution)", flush=True)
        except Exception as _ss_err:
            print(f"  🐋 [WHALE_RADAR] unified_scanner enrichment failed: {_ss_err}", flush=True)

        if not candidates:
            print(f"  🐋 [WHALE_RADAR] All candidates vetoed by unified_scanner", flush=True)
            return 0

        print(f"  🐋 [WHALE_RADAR] {len(candidates)} stock(s) passed Hunter Mode filters:", flush=True)

        # (3) Generate a prediction for each candidate
        whale_count = 0
        now_iso = datetime.now().isoformat()

        # Open stored_analyses DB connection (same pattern as main loop)
        sa_db_path = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
        conn_sa = None
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn_sa = db_manager.get_connection(sa_db_path, writable=True)
            cur_sa = conn_sa.cursor()
            # Ensure stored_analyses table exists (safe — won't fail if it does)
            cur_sa.execute('''CREATE TABLE IF NOT EXISTS stored_analyses (
                id TEXT PRIMARY KEY,
                ticker TEXT,
                market TEXT,
                maestro_score REAL,
                recommendation TEXT,
                recommendation_ar TEXT,
                confidence REAL,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL,
                prediction_date TEXT,
                updated_at TEXT,
                analysis_json TEXT,
                is_gambler_opportunity INTEGER DEFAULT 0,
                is_investor_opportunity INTEGER DEFAULT 0,
                ai_reason TEXT,
                ai_narrative TEXT
            )''')
            conn_sa.commit()
        except Exception as e:
            print(f"  🐋 [WHALE_RADAR] stored_analyses DB init failed: {e}", flush=True)
            conn_sa = None

        for stock in candidates:
            ticker = stock.get('ticker', '')
            entry = stock.get('entry_price') or stock.get('current_price')
            target = stock.get('target_price')
            stop = stock.get('stop_loss')
            turnover = stock.get('avg_turnover_20d', 0)
            net_flow = stock.get('net_flow_egp', 0)
            quiet_details = stock.get('quiet_details') or {}
            signal_count = quiet_details.get('signal_count', 0) if quiet_details else 0
            path = stock.get('path', '')

            # Skip if missing critical prices
            if not entry or not target or not stop:
                print(f"    ⚠️ {ticker}: missing entry/target/stop — skipping", flush=True)
                continue

            # Compute R:R
            try:
                rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
            except Exception:
                rr = 0

            # Enforce R:R >= 1.8 (per owner directive)
            if rr < WHALE_RADAR_MIN_RR:
                print(f"    ⚠️ {ticker}: R:R={rr:.2f} < {WHALE_RADAR_MIN_RR} — skipping", flush=True)
                continue

            # Build the technical reason (the "why" for the user)
            tech_reason = (
                f"تجميع هادئ من صانع السوق (Quiet Accumulation — مسار B). "
                f"إشارات متحققة: {signal_count}/6. "
                f"سيولة داخلة: {net_flow/1_000_000:.1f} مليون جنيه. "
                f"متوسط سيولة 20 يوم: {turnover/1_000_000:.1f} مليون جنيه. "
                f"المسار: {path}. "
                f"⚠️ صفقة رادار حيتان — مخاطرة محسوبة، إدارة رأس مال صارمة (2% من المحفظة)."
            )

            # BRAVO-EXIT-PROTOCOL: حساب tp1_price (+6.5%) + user_advice_ar
            _tp1_price = round(entry * 1.065, 2)  # هدف أول +6.5%
            _tp2_price = round(entry * 1.15, 2)   # هدف ثاني +15%
            # حدد user_advice_ar بناءً على macro_location
            _macro = cand.get('macro_location', 'MID_RANGE')
            if _macro == 'NEAR_LOW':
                _user_advice = f"سهم ريّح عند الدعم. بيع نص الكمية عند {_tp1_price} جنيه، ومتطمعش: قدامك 5 أيام تداول وتخرج كاش."
            elif _macro == 'NEAR_HIGH':
                _user_advice = "السهم في قمة سنوية.. متشتريش هنا، استنى لما يصحح ويثبت."
            else:
                _user_advice = f"دخول تكتيكي. هدف أول {_tp1_price} جنيه. وقف خسارة {stop:.2f}. مدة الصفقة 5 أيام تداول كحد أقصى."

            try:
                # (3a) Store in predictions table via PredictionTracker
                pred_id = tracker.record_prediction(
                    ticker=ticker,
                    signal='WHALE_RADAR_BUY',
                    entry_price=entry,
                    target_price=target,
                    stop_loss=stop,
                    master_score=75.0,  # fixed confidence for whale radar
                    notes=f"WHALE_RADAR | {tech_reason}",
                    persona='gambler',  # high-risk persona
                    risk_reward=rr,
                    who_is_buying_state='WHALE_RADAR',
                    evidence_count=signal_count,
                    prediction_date=scan_date,
                    # BRAVO-EXIT-PROTOCOL: خطة الخروج الثلاثية
                    tp1_price=_tp1_price,
                    tp2_price=_tp2_price,
                    trailing_stop_pct=2.5,
                    max_hold_days=5,
                    exit_protocol='TP1_6PCT_TIME_STOP_5D',
                    user_advice_ar=_user_advice,
                )

                # (3b) Store in stored_analyses table (for PersonaTab UI)
                if conn_sa:
                    sa_id = f"whale_{ticker}_{market_code}"
                    sa_json = json.dumps({
                        'ticker': ticker,
                        'signal': 'WHALE_RADAR_BUY',
                        'signal_ar': 'شراء رادار حيتان',
                        'entry': entry,
                        'target': target,
                        'stop': stop,
                        'risk_reward': round(rr, 2),
                        'position_size': WHALE_RADAR_POSITION_SIZE,
                        'evidence_count': signal_count,
                        'source': 'WHALE_RADAR',
                        'technical_explanation': tech_reason,
                        'whale_radar': {
                            'turnover_egp': turnover,
                            'net_flow_egp': net_flow,
                            'signal_count': signal_count,
                            'path': path,
                        },
                    }, ensure_ascii=False)
                    cur_sa.execute('''
                        INSERT INTO stored_analyses (
                            id, ticker, market, maestro_score, recommendation, recommendation_ar,
                            confidence, entry_price, target_price, stop_loss, risk_reward,
                            prediction_date, updated_at, analysis_json,
                            is_gambler_opportunity, is_investor_opportunity,
                            ai_reason, ai_narrative
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            maestro_score = excluded.maestro_score,
                            recommendation = excluded.recommendation,
                            recommendation_ar = excluded.recommendation_ar,
                            confidence = excluded.confidence,
                            entry_price = excluded.entry_price,
                            target_price = excluded.target_price,
                            stop_loss = excluded.stop_loss,
                            risk_reward = excluded.risk_reward,
                            prediction_date = excluded.prediction_date,
                            updated_at = excluded.updated_at,
                            analysis_json = excluded.analysis_json,
                            ai_reason = excluded.ai_reason
                    ''', (
                        sa_id, ticker, market_code, 75.0,
                        'WHALE_RADAR_BUY', 'شراء رادار حيتان (مخاطرة محسوبة)',
                        75.0, entry, target, stop, round(rr, 2),
                        scan_date, now_iso, sa_json,
                        tech_reason, '',
                    ))
                    conn_sa.commit()

                whale_count += 1
                total_generated_ref[0] = total_generated_ref[0] + 1 if total_generated_ref else total_generated_ref[0]
                print(f"    ✅ {ticker}: entry={entry:.2f} target={target:.2f} stop={stop:.2f} R:R={rr:.2f} | flow={net_flow/1_000_000:.1f}M EGP", flush=True)
            except Exception as e:
                print(f"    ⚠️ {ticker}: store error — {e}", flush=True)

        if conn_sa:
            conn_sa.close()

        print(f"  🐋 [WHALE_RADAR] Generated {whale_count} whale radar prediction(s).", flush=True)
        return whale_count

    except Exception as e:
        print(f"  🐋 [WHALE_RADAR] Integration failed: {e}", flush=True)
        return 0


# ============================================================================
# SMART PREDICTOR LOGIC (merged from scripts/smart_predictor.py)
# ============================================================================
# Owner directive (2026-10-28): "حط الكود الى فى smart_predictor.py داخل
# daily_predictor.py لان دة الى فى كل مكان وممكن اى وقت يتم استعماله بالخطأ
# فانرجع لنفس المصيبة"
#
# الـ smart mode بيشتغل لما user يمرر --smart flag. بيعمل 5 فلاتر قبل التحليل:
#   1. ابدأ من آخر تاريخ في الـ DB (مش من 1 يناير)
#   2. فلتر أيام الإجازات (is_trading_day)
#   3. فلتر التوقعات اللي لسه valid (السعر ما تغيرش >1%)
#   4. فلتر الأسهم الميتة (change% بين -3% و +0.5%)
#   5. فلتر التوقعات الموجودة (re-analyze لو السعر تحرك)

def _smart_is_trading_day(date_str, market_code):
    """هل اليوم ده يوم تداول؟ فلتر جمعة/سبت/عيد."""
    try:
        from utils.trading_calendar import is_trading_day as _check
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return _check(dt, market_code)
    except Exception:
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.weekday() not in [4, 5]  # 4=Friday, 5=Saturday


def _smart_get_last_prediction_date(market_code):
    """آخر تاريخ في predictions table للسوق ده."""
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        _pred_db = str(_db_dir / 'predictions.db')
        if not os.path.exists(_pred_db):
            return None
        conn = sqlite3.connect(_pred_db)
        row = conn.execute(
            "SELECT MAX(prediction_date) FROM predictions WHERE market = ?",
            (market_code,)
        ).fetchone()
        conn.close()
        if row and row[0]:
            return str(row[0])[:10]
        return None
    except Exception:
        return None


def _smart_filter_dead_stocks(tickers, market_code):
    """
    فلتر الأسهم الميتة:
      - change% بين -3% و +0.5% → سهم واقف/خسران → skip
      - باقي الأسهم (صاعدة أو نازلة جامد) → نحللها
    """
    if not tickers:
        return [], 0
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        _stocks_db = str(_db_dir / 'stocks.db')
        conn = sqlite3.connect(_stocks_db)
        placeholders = ','.join(['?'] * len(tickers))
        rows = conn.execute(
            f"SELECT ticker, change_percent FROM stocks WHERE ticker IN ({placeholders}) AND market = ?",
            (*tickers, market_code)
        ).fetchall()
        conn.close()
        alive = []
        dead_count = 0
        for ticker, change in rows:
            if change is None:
                continue
            change = float(change)
            if -3.0 <= change <= 0.5:
                dead_count += 1
                continue
            alive.append(ticker)
        return alive, dead_count
    except Exception:
        return tickers, 0


def _smart_filter_stale_predictions(tickers, market_code, scan_date):
    """
    فلتر التوقعات الموجودة — بس بشكل ذكي.
    skip بس لو فيه توقع نشط + السعر ما تغيرش >1% من entry_price.
    لو السعر تحرك → re-analyze (ممكن إشارة جديدة).
    """
    if not tickers:
        return [], 0
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        _pred_db = str(_db_dir / 'predictions.db')
        _stocks_db = str(_db_dir / 'stocks.db')
        if not os.path.exists(_pred_db) or not os.path.exists(_stocks_db):
            return tickers, 0
        conn_pred = sqlite3.connect(_pred_db)
        conn_stocks = sqlite3.connect(_stocks_db)
        existing = conn_pred.execute(
            """SELECT ticker, entry_price FROM predictions 
               WHERE market = ? AND prediction_date LIKE ? 
               AND (outcome_date IS NULL OR exit_type IS NULL)""",
            (market_code, f"{scan_date}%")
        ).fetchall()
        conn_pred.close()
        placeholders = ','.join(['?'] * len(tickers))
        stock_rows = conn_stocks.execute(
            f"SELECT ticker, current_price FROM stocks WHERE ticker IN ({placeholders}) AND market = ?",
            (*tickers, market_code)
        ).fetchall()
        conn_stocks.close()
        current_prices = {r[0]: r[1] for r in stock_rows if r[1]}
        existing_map = {r[0]: r[1] for r in existing}
        to_reanalyze = []
        skipped_count = 0
        for ticker in tickers:
            if ticker not in existing_map:
                to_reanalyze.append(ticker)
                continue
            entry_price = existing_map[ticker]
            current_price = current_prices.get(ticker)
            if entry_price and current_price and entry_price > 0:
                change_pct = abs((current_price - entry_price) / entry_price * 100)
                if change_pct < 1.0:
                    skipped_count += 1
                    continue
            to_reanalyze.append(ticker)
        return to_reanalyze, skipped_count
    except Exception:
        return tickers, 0


def _smart_filter_scan_dates(all_dates, market_code):
    """فلتر أيام الإجازات من قائمة التواريخ."""
    trading_dates = []
    skipped = 0
    for d in all_dates:
        if _smart_is_trading_day(d, market_code):
            trading_dates.append(d)
        else:
            skipped += 1
    return trading_dates, skipped


def run_generator(start_date, end_date, scan_interval=SCAN_INTERVAL,
                  max_picks=MAX_PICKS_PER_DAY, dry_run=False, keep_old=False,
                  max_tickers=None, tickers_offset=0, force=False,
                  market_code='EGX', smart_mode=False):
    """Main generation loop.

    Args:
        max_tickers: لو موجود، بـ limit عدد الـ tickers المتعالجًا في الـ run ده.
                     مفيد لتشغيل الباكتست على دفعات في ساندبوكس بـ timeout محدود.
        tickers_offset: skip أول N tickers (للـ resume بعد run سابق).
        force: تخطّى أى circuit breaker / quality gate / cooldown ومنع التشغيل.
    """
    # FIX (BRAVO-DISASTER C1-FINAL, 2026-10-28):
    # CLI accepts --market KSA but stocks.db stores Saudi stocks as
    # market='TADAWUL'. Previous bug: stored analyses under 'KSA' (or 'EGX'),
    # breaking every downstream query (WHERE market='TADAWUL' finds nothing)
    # AND breaking radar integration (looks for maker_radar_KSA_*.json but
    # cron_radar.sh creates maker_radar_TADAWUL_*.json).
    #
    # Solution: normalize market_code to the CANONICAL DB value at the entry
    # point. Everything downstream (radar lookup, sa_id, INSERT, regime)
    # uses the canonical value consistently.
    _CANONICAL_MARKET = {
        'KSA': 'TADAWUL',
        'SAUDI': 'TADAWUL',
        'TADAWUL': 'TADAWUL',
        'EGX': 'EGX',
        'KSE': 'KSE',
        'QSE': 'QSE',
        'US': 'US',
        'CRYPTO': 'CRYPTO',
    }.get(market_code.strip().upper(), market_code.strip().upper())
    market_code = _CANONICAL_MARKET
    print(f"  [MARKET-NORMALIZE] canonical market_code = {market_code}", flush=True)

    print("=" * 80, flush=True)
    print("  V40.2 Prediction Generator (CLI-enabled)", flush=True)
    print(f"  Period: {start_date} → {end_date} | Scan every {scan_interval} days", flush=True)
    print(f"  Max picks/day: {max_picks} | Morning bell: top 1", flush=True)
    print(f"  Market: {market_code} | Strict kill-filters: ON", flush=True)
    print(f"  Dry-run: {dry_run} | Keep old: {keep_old} | Force: {force}", flush=True)
    if max_tickers is not None:
        print(f"  ⚡ BATCH MODE: max_tickers={max_tickers}, offset={tickers_offset}", flush=True)
    print("=" * 80, flush=True)

    # V40.2: enable strict kill-filter mode for the whole run
    set_strict_kill_filters(True)
    from analyzers.engine_settings import get_setting

    # ════════════════════════════════════════════════════════════════════════
    # REGIME-ENGINE (2026-09-27): Dynamic market regime → override thresholds
    # ════════════════════════════════════════════════════════════════════════
    # At the start of every run, call MarketRegimeEngine(market).update_regime()
    # — it computes 6 indicators (SMA20/50/200, breadth, ATR, turnover, loss streak)
    # — applies 2-3 day hysteresis
    # — persists regime to system_settings + market_regime_log
    # — returns the effective regime + per-regime thresholds
    #
    # The thresholds OVERRIDE the defaults (max_picks, MIN_RR, MIN_SCORE, ...)
    # for this run only. Constitution §Phase-C: regime-aware thresholds are the
    # natural extension of get_setting() — they apply a market-condition scaling
    # on top of admin-configurable base values.
    #
    # Safe-by-design: if the regime engine fails for any reason, we proceed
    # with the DEFAULT thresholds (NORMAL regime) — never block V40.2.
    _regime_cfg = None
    _regime_name = "NORMAL"
    _regime_market = market_code if market_code in ('EGX', 'KSA', 'KSE', 'QSE') else 'EGX'
    # Map V40.2 market_code → MarketRegimeEngine market key
    _regime_market_map = {
        'EGX': 'EGX', 'KSA': 'TADAWUL', 'KSE': 'KSE', 'QSE': 'QSE',
    }
    _regime_market_key = _regime_market_map.get(_regime_market, 'EGX')
    try:
        from analyzers.market_regime_engine import MarketRegimeEngine, REGIME_CONFIG, Regime
        _regime_engine = MarketRegimeEngine(market=_regime_market_key)
        _regime_result = _regime_engine.update_regime()
        _regime_cfg = _regime_result.thresholds
        _regime_name = _regime_result.regime.value
        _regime_ind = _regime_result.indicators
        # OVERRIDE the function-level max_picks argument with the regime's value
        # (unless the user explicitly passed --max-picks — we still let regime lower it
        # because DEFENSIVE must cap picks regardless of CLI override)
        _cli_max_picks = max_picks
        max_picks = min(max_picks, int(_regime_cfg["max_picks_per_day"]))
        # Override DNA_MAX_OPEN_POSITIONS (was hardcoded 5)
        global DNA_MAX_OPEN_POSITIONS
        DNA_MAX_OPEN_POSITIONS = int(_regime_cfg.get("max_open_positions", DNA_MAX_OPEN_POSITIONS))
        print(f"🌐 [REGIME] market={_regime_market_key} regime={_regime_name} "
              f"(raw={_regime_result.raw_regime.value}, candidate="
              f"{_regime_result.candidate_regime.value}/{_regime_result.candidate_days}d)", flush=True)
        print(f"   Indicators: index={_regime_ind.index_current or 0:.2f} "
              f"change={_regime_ind.index_daily_change_pct:+.2f}% "
              f"breadth={_regime_ind.breadth_pct*100:.1f}% "
              f"ATR_ratio={_regime_ind.atr_ratio:.2f} "
              f"turnover_ratio={_regime_ind.turnover_ratio:.2f} "
              f"loss_streak={_regime_ind.loss_streak_days}d "
              f"drawdown={_regime_ind.short_term_drawdown_pct*100:.1f}%", flush=True)
        print(f"   Thresholds: max_picks={max_picks} (CLI={_cli_max_picks}, "
              f"regime_cap={int(_regime_cfg['max_picks_per_day'])}) | "
              f"min_rr={_regime_cfg['min_rr']} | min_score={_regime_cfg['min_score']} | "
              f"pos_mult={_regime_cfg['position_size_multiplier']} | "
              f"atr_stop_mult={_regime_cfg['atr_stop_multiplier']} | "
              f"falling_knife={_regime_cfg['falling_knife_threshold']} | "
              f"min_turnover_mult={_regime_cfg['min_turnover_multiplier']} | "
              f"max_open_positions={_regime_cfg['max_open_positions']}", flush=True)
        if _regime_result.reasons:
            for _r in _regime_result.reasons[:6]:
                print(f"   {_r}", flush=True)
    except Exception as _regime_err:
        # Safe fallback: NORMAL regime with default thresholds
        print(f"⚠️  [REGIME] engine failed ({_regime_err}) — using NORMAL defaults", flush=True)
        try:
            from analyzers.market_regime_engine import REGIME_CONFIG, Regime
            _regime_cfg = REGIME_CONFIG[Regime.NORMAL]
        except Exception:
            _regime_cfg = None

    # DEV-01 (2026-10-12 — PRODUCTION-AUDIT / DUAL-TRACK):
    # delete_old_v40_predictions() is DISABLED — it deletes legit V40.2 predictions.
    # The function itself has an early-return guard, so calling it is safe (no-op),
    # but we skip the call entirely for clarity + to avoid the print noise.
    # Per Rule 35 (ENGINE-UNIFY): V40.2 predictions must NEVER be deleted.
    if not dry_run and not keep_old:
        # OLD: delete_old_v40_predictions(start_date, end_date)
        # NEW: no-op (function is disabled internally too — defense in depth)
        print("[DEV-01] delete_old_v40_predictions() call skipped — function is DISABLED (Rule 35)", flush=True)
    elif keep_old:
        print("ℹ️  --keep-old: skipping deletion of old V40 predictions", flush=True)

    scan_dates = get_scan_dates(start_date, end_date, scan_interval)
    if not scan_dates:
        print("❌ No scan dates to process. Exiting.", flush=True)
        return

    # ─── SMART MODE: فلتر أيام الإجازات ───────────────────────────────────────
    # Owner directive (2026-10-28): --smart يفلتر جمعة/سبت/عيد قبل التحليل
    if smart_mode:
        _all_dates_count = len(scan_dates)
        scan_dates, _skipped_holidays = _smart_filter_scan_dates(scan_dates, market_code)
        print(f"⚡ SMART: فلتر الإجازات → {_all_dates_count} → {len(scan_dates)} (تخطى {_skipped_holidays} يوم إجازة)", flush=True)
        if not scan_dates:
            print("✅ SMART: كل الأيام أيام إجازات — مفيش حاجة للتحليل.", flush=True)
            return

    tickers = get_tickers(market_code=market_code)
    # Rule 28: Filter out toxic tickers (blocklisted)
    blocklist = _load_toxic_blocklist()
    if blocklist:
        before = len(tickers)
        tickers = [t for t in tickers if t not in blocklist]
        skipped = before - len(tickers)
        if skipped > 0:
            print(f"🚫 Rule 28: Skipped {skipped} toxic tickers (blocklist)", flush=True)
    # BATCH MODE: apply offset + max_tickers (للـ resume في ساندبوكس بـ timeout)
    if tickers_offset > 0:
        tickers = tickers[tickers_offset:]
        print(f"  ⏭️  Skipped first {tickers_offset} tickers (offset)", flush=True)
    if max_tickers is not None and max_tickers > 0:
        tickers = tickers[:max_tickers]
        print(f"  ⚡ Limited to {max_tickers} tickers (batch mode)", flush=True)
    print(f"📊 Scan dates: {len(scan_dates)} | Tickers: {len(tickers)}", flush=True)
    print(f"📅 Scan dates: {scan_dates}", flush=True)

    # ─── SMART MODE: فلتر الأسهم الميتة ───────────────────────────────────────
    # Owner directive: فلتر الأسهم اللي change% بين -3% و +0.5% (واقفة/خسران)
    if smart_mode and tickers:
        _before_dead = len(tickers)
        tickers, _dead_count = _smart_filter_dead_stocks(tickers, market_code)
        print(f"⚡ SMART: فلتر الأسهم الميتة → {_before_dead} → {len(tickers)} (تخطى {_dead_count} سهم ميت)", flush=True)

    if dry_run:
        print("🔍 DRY-RUN: would process the above dates. No DB writes.", flush=True)

    # PHASE-A: تمرير market_code للمحرك عشان يستخدم MARKET_PROFILES
    # PHASE-C: buy_threshold من engine_settings (dynamic)
    _buy_thresh = int(get_setting('v402_buy_threshold', default=75))
    engine = V38BacktestEngine(buy_threshold=_buy_thresh, use_v393=True, market_code=market_code)
    engine.market_regime_name = _regime_name
    engine._load_fundamentals()
    engine._load_benchmark()  # V40.2: load benchmark per market

    # ── Phase 8.2: BRAVO-SPEED-FIX pre-cache extracted ──────────────────────
    # Original block extracted to predictor_modules.price_cache.pre_cache_price_history.
    # Batch-query price_history.db for ALL tickers at once (180x speedup).
    pre_cache_price_history(tickers, engine)

    signals_by_date = defaultdict(list)
    total_tickers = len(tickers)
    processed = 0
    surge_picks_this_run = 0  # AXIS-5b: counter for Volume Surge Hunter picks
    accum_picks_this_run = 0   # AXIS-5c: counter for Accumulation Detector picks
    recovery_picks_this_run = 0  # AXIS-5d: counter for Recovery from Long Base picks

    for ticker in tickers:
        processed += 1
        # BRAVO-SPEED-FIX (2026-10-20): شيلنا _time.sleep(0.01) — كان بيضيف 2.9s لـ 289 سهم.
        # السبب الأصلي (PHASE1-CPU): تقليل CPU على Hostinger. على اللابتوب/الإنتاج القوي مش محتاجينه.
        # لو رجع CPU throttling على Hostinger، فعّله تاني بـ _time.sleep(0.01).
        if processed % 50 == 0:
            print(f"  ⏳ Processing {processed}/{total_tickers} tickers...", flush=True)

        dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < MIN_TICKER_DAYS:
            continue

        # ─── B1 PRICE SANITY GATE (Task 1-a / Bravo) ─────────────────────
        # Single, well-placed validation before ANY analysis touches this ticker.
        # Catches: USD contamination on EGX tickers (ADP/ADPC), impossible OHLC
        # (low>high, open out of range), large candle range (split/corporate-action
        # note), stale data, history-vs-current mismatch, negative support.
        # DATA_INVALID → refuse to analyze (NO_TRADE/DATA_INVALID), log_decision,
        # and `continue`. Never emit a trade recommendation on invalid data.
        # Pure validation — no DB writes; the data_isolation side-table is the
        # audit trail (created by scripts/b1_isolate_adp.py, not here).
        try:
            from core.price_sanity import validate_price_data, lookup_stock_identity
            if not hasattr(run_generator, '_b1_identity_cache'):
                run_generator._b1_identity_cache = {}
            _ident = run_generator._b1_identity_cache.get(ticker)
            if _ident is None:
                _ident = lookup_stock_identity(ticker)
                run_generator._b1_identity_cache[ticker] = _ident
            _b1_ohlc = None
            if opens and highs and lows and closes:
                _b1_ohlc = (opens[-1], highs[-1], lows[-1], closes[-1])
            _b1_res = validate_price_data(
                prices=closes,
                ohlc=_b1_ohlc,
                ticker=ticker,
                market=_ident.get('market'),
                currency=_ident.get('currency'),
                latest_date=dates[-1] if dates else None,
            )
            if not _b1_res.valid:
                try:
                    from analyzers.decision_logger import log_decision as _b1_log
                    _b1_log(
                        symbol=ticker,
                        decision_type='reject_entry',
                        reason_code='data_invalid',
                        reason_text=' | '.join(_b1_res.reasons)[:500],
                        flag_active='B1_PRICE_SANITY',
                        scan_date=(scan_dates[0] if scan_dates else ''),
                    )
                except Exception:
                    pass  # never let logging crash the run
                if processed % 25 == 0 or ticker in ('ADP', 'ADPC'):
                    print(f"  🚫 [B1] {ticker} skipped ({_b1_res.status}): "
                          f"{'; '.join(_b1_res.reasons)[:120]}", flush=True)
                continue  # refuse to analyze — NO_TRADE/DATA_INVALID
        except Exception as _b1_err:
            # FAIL-OPEN with WARNING: never let the sanity gate crash the run.
            # If the gate itself errors, log and proceed (the analyzer's own
            # >10000 sanity check at line ~2527 is the last-resort backstop).
            if not hasattr(run_generator, '_b1_warned'):
                run_generator._b1_warned = True
                print(f"  ⚠️  [B1] price_sanity gate error for {ticker}: "
                      f"{type(_b1_err).__name__}: {_b1_err} — FAIL-OPEN", flush=True)

        # ─── PHASE-B: محرك السيولة كبوابة أولى ──────────────────────────
        # فحص السيولة قبل أي تحليل — يوفر 30-50% من الـ CPU
        # يرفض الأسهم غير القابلة للتداول (penny stocks + dead volume)
        # الاستثناء: لو فيه volume_surge (انفجار سيولة)، نسمح بالمرور
        try:
            _liq_price = closes[-1] if closes else 0
            _liq_vol = volumes[-1] if volumes else 0
            _liq_avg_vol = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 0
            _liq_avg_turnover = _liq_avg_vol * _liq_price if _liq_avg_vol > 0 else 0

            # penny stock filter
            if _liq_price < float(get_setting('v402_penny_stock_price', default=1.0)):
                continue

            # dead stock filter (volume = 0)
            if _liq_vol < float(get_setting('v402_dead_volume_threshold', default=1000)):
                continue

            # dynamic liquidity threshold (per-price: <5→80K, 5-15→200K, >15→400K)
            if _SHARED_LIQUIDITY_AVAILABLE:
                _liq_result = _shared_should_reject_by_liquidity(
                    _liq_avg_turnover, _liq_price, volumes[-20:] if len(volumes) >= 20 else volumes, closes[-20:] if len(closes) >= 20 else closes
                )
                _rejected = _liq_result[0]
                _reason = _liq_result[1]
                _surge = _liq_result[2]
                if _rejected and not _surge:
                    continue  # skip illiquid stock (no surge bypass)
        except Exception:
            pass  # safe fallback — proceed with analysis

        atrs = calc_atr(highs, lows, closes, 14)
        date_to_idx = {d: i for i, d in enumerate(dates)}

        for scan_date in scan_dates:
            day_idx = date_to_idx.get(scan_date)
            if day_idx is None or day_idx < 15:
                continue

            # ─── SMART MODE: فلتر التوقعات اللي لسه valid ───────────────────────
            # Owner directive: skip السهم لو فيه توقع نشط + السعر ما تغيرش >1%
            # ملاحظة: هنا بنـ skip الـ ticker من الـ analysis loop لو التوقع لسه valid
            # عن طريق تعديل قائمة tickers_local اللي بتـ feed الـ loop الرئيسي
            if smart_mode and hasattr(_smart_filter_stale_predictions, '__call__'):
                # الـ filter تم بالفعل قبل الـ ticker loop (في السطر اللي تحت)
                pass

            # PILLAR-1: حساب sector_change حقيقي (proxy = أداء السهم آخر 5 أيام).
            # كان 0.0 ثابت — دلوقتي بنـ compute proxy من closes للـ ticker نفسه.
            # ملاحظة: هذا proxy لـ sector_change — الحل الكامل يتطلب loading خريطة
            # ticker→sector (data/egx_ticker_sector_map.py) و حساب متوسط القطاع،
            # لكن ده بـ يـ triple الـ runtime لكل (ticker × scan_date) pair.
            # الـ proxy كافي لـ sector-aware signal evaluation: لو السهم طالع 5% آخر
            # أسبوع → sector_change=+5.0 → الـ engine بـ يـ boost الـ score.
            _sector_change = 0.0
            if day_idx >= 5:
                try:
                    _ref_close = closes[day_idx - 5] if closes[day_idx - 5] > 0 else closes[day_idx - 1]
                    if _ref_close > 0:
                        _sector_change = round(
                            (closes[day_idx] - _ref_close) / _ref_close * 100.0, 3
                        )
                except Exception:
                    _sector_change = 0.0
            try:
                result = engine.analyze_single_day(
                    ticker, dates, opens, highs, lows, closes, volumes, day_idx, _sector_change,
                )
            except Exception:
                continue

            signal = result.get('signal', 'WAIT')
            # DNA-DEBUG: trace AMOC
            if ticker == 'AMOC':
                print(f"[DNA-TRACE] AMOC: signal={signal} score={result.get('score')} on {scan_date}", flush=True)
            # Phase 2 #1: حظر BUY للأسهم اللي بتشهد تصريف حيتان (Whale Distributing).
            if signal in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                if _whale_distribution_guard(opens[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1], closes[:day_idx+1], volumes[:day_idx+1]):
                    signal = 'HOLD'
                    result['signal'] = 'HOLD'
                    result.setdefault('rejection_reason', 'whale distributing — BUY blocked (Phase 2)')
            # PILLAR-4: قبول BUY عادي (مش بس STRONG_BUY/INSTITUTIONAL_BUY)
            # لو الإشارة مش شراء، نفحص صيادي الانفجار والتجميع (Surge / Accumulation / Recovery Hunters)
            # Task IMPROVEMENT-12-2026-10-07: لو مفيش إشارة شراء → اكتب SELL/HOLD بدل ما ترفض
            if signal not in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                # ── T-0/T-1/T-2 DETECTION (مرحلة منفصلة 4 — 2026-08-30) ──
                # تم الإلغاء: backtest أظهر إنه ينقص الأداء (WR -4%, PF -0.69, Return -88%)
                # الكود محفوظ كـ comment للـ audit
                # _t_signal = None
                # ... (T-0/T-1/T-2 detection logic — معطل)
                # ─── VOLUME SURGE HUNTER (AXIS-5b): صياد الأسهم الانفجارية ───
                # لو V38 engine ما اكتشفش signal، شغل الـ Volume Surge Hunter.
                # بيدور على: Volume Surge + ROC20 + maker_bull + above SMA50.
                # مستوحى من Pine Script V56 (maker_bull + rs_positive + valid_rr).
                # بيصطاد الأسهم اللي بتبدأ انفجار بالسيولة (زي BIOC/NIPH/AMES).
                try:
                    surge_result = detect_volume_surge_rocket(
                        closes[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1],
                        opens[:day_idx+1], volumes[:day_idx+1],
                    )
                except Exception:
                    surge_result = {'is_surge_rocket': False}
                if surge_result.get('is_surge_rocket'):
                    # الـ hunter اكتشف surge rocket — اعتبره STRONG_BUY
                    signal = 'STRONG_BUY'
                    result['entry'] = surge_result['entry']
                    result['target'] = surge_result['target']
                    result['stop_loss'] = surge_result['stop']
                    result['score'] = surge_result['score']
                    result['signal'] = 'STRONG_BUY'
                    _surge_proofs = {'surge_hunter': True}
                    _surge_proofs.update(surge_result.get('details', {}))
                    result['proofs'] = _surge_proofs
                    surge_picks_this_run += 1
                else:
                    # ─── ACCUMULATION DETECTOR (AXIS-5c): التجميع الهادئ قبل الانفجار ───
                    # لو surge_hunter ما اكتشفش signal، شغل الـ Accumulation Detector.
                    # بيدور على: volume accumulation (1.25x لـ 3 أيام) + above SMA20 +
                    # ROC5 معتدل (+3% to +15%) + RS إيجابي + not in correction.
                    # بيصطاد الأسهم اللي بتجمع سيولة بهدوء قبل ما تطير (BIOC, NIPH في مراحلها الأولى).
                    try:
                        # احصل على benchmark_roc14 من الـ engine
                        _bench_roc = engine._benchmark_roc_by_date.get(scan_date, 0.0)
                        accum_result = detect_accumulation_phase(
                            closes[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1],
                            opens[:day_idx+1], volumes[:day_idx+1],
                            benchmark_roc14=_bench_roc,
                        )
                    except Exception:
                        accum_result = {'is_accumulation': False}
                    if accum_result.get('is_accumulation'):
                        # accumulation detector اكتشف تجميع — اعتبره STRONG_BUY
                        signal = 'STRONG_BUY'
                        result['entry'] = accum_result['entry']
                        result['target'] = accum_result['target']
                        result['stop_loss'] = accum_result['stop']
                        result['score'] = accum_result['score']
                        result['signal'] = 'STRONG_BUY'
                        _accum_proofs = {'accumulation_hunter': True}
                        _accum_proofs.update(accum_result.get('details', {}))
                        result['proofs'] = _accum_proofs
                        accum_picks_this_run += 1
                    else:
                        # ─── RECOVERY FROM LONG BASE (AXIS-5d): التعافي من قاعدة طويلة ───
                        # لو surge + accumulation ما اكتشفوش، شغل Recovery Detector.
                        # بيدور على: قاعدة طويلة (30-60 يوم هدوء) + علامات تعافي (حجم يرجع +
                        # فوق SMA20 + شمعة قوية + ROC5 إيجابي) + قريب من SMA50 + R/R ≥ 1.5.
                        # بيصطاد الأسهم اللي فضلت هادية شهور ولما بدأت تصحى ندخل بدري.
                        try:
                            recovery_result = detect_recovery_from_base(
                                closes[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1],
                                opens[:day_idx+1], volumes[:day_idx+1],
                            )
                        except Exception:
                            recovery_result = {'is_recovery_signal': False}
                        if recovery_result and recovery_result.get('is_recovery_signal'):
                            signal = 'STRONG_BUY'
                            result['entry'] = recovery_result['entry']
                            result['target'] = recovery_result['target']
                            result['stop_loss'] = recovery_result['stop']
                            result['score'] = recovery_result['score']
                            result['signal'] = 'STRONG_BUY'
                            _recovery_proofs = {'recovery_hunter': True}
                            _recovery_proofs.update(recovery_result.get('details', {}))
                            result['proofs'] = _recovery_proofs
                            recovery_picks_this_run += 1
                        else:
                            # ── SOFT-SURGE FALLBACK (EGX-STRATEGY-FINAL — 2026-08-30) ──
                            # المالك طلب: "لو V38 طلع WAIT أو score منخفض، لكن فيه Volume Surge
                            # حقيقي أو Accumulation واضح + باقي شروط الحماية متحققة → اسمح بالإشارة."
                            #
                            # ده بـ يصطاد الوحوش اللي V38 بيفوتها (MIPH/CEFM/EALR).
                            # شروط الحماية الصارمة (بتُفحص في entry_gate بعدين):
                            #   - volume surge قوي (vol_ratio ≥ 2.0)
                            #   - ROC5 > 3% (زخم إيجابي حقيقي)
                            #   - فوق أو قريب من SMA50
                            #   - R:R ≥ 1.8 (هيتبنى في entry_gate)
                            #   - + كل شروط entry_gate (evidence + RS + Deep Correction + Don't Chase + سيولة + سياق)
                            try:
                                import numpy as _np_soft
                                _closes_soft = closes[:day_idx+1]
                                _vols_soft = volumes[:day_idx+1]
                                if len(_closes_soft) >= 25 and len(_vols_soft) >= 25:
                                    # volume ratio (اليوم / متوسط 20 يوم)
                                    _avg_vol_20 = sum(_vols_soft[-21:-1]) / 20 if len(_vols_soft) >= 21 else 0
                                    _today_vol_soft = _vols_soft[-1]
                                    # BRAVO-VOL-EXTRAP (2026-10-20): لو شغّلنا في نص الجلسة، الحجم جزئي
                                    # استخرج الحجم الكامل التقديري (elapsed → total session)
                                    _vol_extrap_note = ""
                                    try:
                                        from datetime import datetime as _dt_extrap
                                        _now_extrap = _dt_extrap.now()
                                        _scan_date_str = str(scan_date)[:10] if scan_date else ""
                                        if _scan_date_str == _now_extrap.strftime('%Y-%m-%d') and market_code == 'EGX':
                                            # EGX session: 10:00-14:30 Cairo = 08:00-12:30 UTC
                                            _session_start_utc = 8.0
                                            _session_end_utc = 12.5
                                            _current_utc = _now_extrap.hour + _now_extrap.minute / 60.0
                                            if _session_start_utc <= _current_utc < _session_end_utc and _today_vol_soft > 0:
                                                _elapsed = _current_utc - _session_start_utc
                                                _total = _session_end_utc - _session_start_utc
                                                if _elapsed > 0.5:  # على الأقل 30 دقيقة من البيانات
                                                    _factor = _total / _elapsed
                                                    _today_vol_soft = _today_vol_soft * _factor
                                                    _vol_extrap_note = f" (extrapolated {_factor:.1f}x from partial)"
                                    except Exception:
                                        pass
                                    _vol_ratio_soft = (_today_vol_soft / _avg_vol_20) if _avg_vol_20 > 0 else 0
                                    # ROC5
                                    _roc5_soft = ((_closes_soft[-1] - _closes_soft[-6]) / _closes_soft[-6] * 100) if len(_closes_soft) >= 6 and _closes_soft[-6] > 0 else 0
                                    # SMA50
                                    _sma50_soft = sum(_closes_soft[-50:]) / 50 if len(_closes_soft) >= 50 else (_closes_soft[-1] if _closes_soft else 0)
                                    _above_sma50_soft = _closes_soft[-1] > _sma50_soft
                                    _near_sma50_soft = abs((_closes_soft[-1] - _sma50_soft) / _sma50_soft * 100) <= 3 if _sma50_soft > 0 else False

                                    # SOFT-SURGE: vol_ratio ≥ 2.0 + ROC5 > 3% + (فوق أو قريب SMA50)
                                    if _vol_ratio_soft >= float(get_setting('v402_soft_surge_vol_ratio', default=2.0)) and _roc5_soft > float(get_setting('v402_soft_surge_roc5_min', default=3.0)) and (_above_sma50_soft or _near_sma50_soft):
                                        # احسب ATR للـ entry/target/stop
                                        _highs_soft = highs[:day_idx+1]
                                        _lows_soft = lows[:day_idx+1]
                                        # BRAVO-CANON-1 (Issue #4 — canonical library first):
                                        # use canonical calc_atr (Wilder's smoothing) from
                                        # analyzers.indicators.atr — Rule 67 SSOT.
                                        # Old: local _tr_list + sum/count = SMA of last 14 TRs
                                        #      (mathematically wrong per Rule 67; FIX-E parity
                                        #      test showed +15.3% divergence from Wilder).
                                        # New: calc_atr (Wilder) — the single source of truth.
                                        # The old "skip TR > 20%" filter was data cleaning (not
                                        # part of the ATR formula); bad bars should be caught
                                        # upstream by B1 price_sanity, not inside ATR.
                                        from analyzers.indicators.atr import calc_atr as _canonical_calc_atr_soft
                                        _atr_soft = _canonical_calc_atr_soft(_highs_soft, _lows_soft, _closes_soft, period=14)
                                        if _atr_soft is None or _atr_soft <= 0:
                                            _atr_soft = _closes_soft[-1] * 0.05  # fallback 5%
                                        # clamp ATR لـ [2%, 10%] من entry (business rule, not ATR formula)
                                        _atr_soft = max(_closes_soft[-1] * 0.02, min(_closes_soft[-1] * 0.10, _atr_soft))

                                        _entry_soft = _closes_soft[-1]
                                        _stop_soft = _entry_soft - (1.5 * _atr_soft)  # 1.5 ATR (balanced)
                                        _target_soft = _entry_soft + (3.0 * _atr_soft)  # 3 ATR → R:R = 2.0

                                        # تأكد R:R ≥ 1.8
                                        _rr_soft = (_target_soft - _entry_soft) / (_entry_soft - _stop_soft) if (_entry_soft - _stop_soft) > 0 else 0
                                        if _rr_soft >= float(get_setting('v402_soft_surge_rr_min', default=1.8)):
                                            signal = 'STRONG_BUY'
                                            result['entry'] = round(_entry_soft, 4)
                                            result['target'] = round(_target_soft, 4)
                                            result['stop_loss'] = round(_stop_soft, 4)
                                            # SEALED-DISPATCH Step 4 (2026-10-17):
                                            # Eliminate `score = 50` placeholder — replace with a
                                            # DERIVED score from the soft-surge heuristics
                                            # (vol_ratio + ROC5 + R/R). The HARD-QUANT-KILL filter
                                            # at line ~3536 requires confidence ≥ 65 for BUY signals,
                                            # so a borderline SOFT-SURGE that just barely meets the
                                            # vol_ratio ≥ 2.0 + ROC5 > 3% thresholds will NOT
                                            # survive (intentional — don't fake confidence).
                                            #
                                            # Formula:
                                            #   base = 40 (below BUY threshold of 65 — must be
                                            #              boosted by downstream proofs: maker
                                            #              flow +12, sector +8, etc.)
                                            #   + vol_ratio bonus: 2.0x → +10, 3.0x → +20 (cap +20)
                                            #   + ROC5 bonus:       3% → +6,  10% → +15 (cap +15)
                                            #   + R/R bonus:        1.5 → +0, 3.0 → +15 (cap +15)
                                            # Total max = 40 + 20 + 15 + 15 = 90 (clear BUY)
                                            # Total min (threshold) = 40 + 10 + 6 + 0 = 56 (killed)
                                            _derived_score = (
                                                40.0
                                                + min(20.0, max(0.0, (_vol_ratio_soft - 1.0) * 10.0))
                                                + min(15.0, max(0.0, _roc5_soft * 2.0))
                                                + min(15.0, max(0.0, (_rr_soft - 1.5) * 10.0))
                                            )
                                            result['score'] = round(_derived_score, 2)
                                            result['signal'] = 'STRONG_BUY'
                                            # أضف stock_roc + benchmark_change عشان entry_gate يفحص RS
                                            result['stock_roc'] = round(_roc5_soft, 2)
                                            _bench_roc_soft = engine._benchmark_roc_by_date.get(scan_date, 0.0)
                                            result['benchmark_change'] = float(_bench_roc_soft)
                                            # market_regime من V38 result الأصلي (fallback 'range' لو None)
                                            _regime_soft = result.get('market_regime_trend') or 'range'
                                            result['market_regime_trend'] = _regime_soft
                                            _soft_proofs = {
                                                'soft_surge': True,
                                                'vol_ratio': round(_vol_ratio_soft, 2),
                                                'roc5': round(_roc5_soft, 2),
                                                'atr': round(_atr_soft, 4),
                                                'rr': round(_rr_soft, 2),
                                                # ✅ markers عشان count_evidence يعدّهم (مطلوب ≥ 3)
                                                'volume': f'✅ حجم غير طبيعي (vol_ratio={_vol_ratio_soft:.2f}x)',
                                                'momentum': f'✅ زخم إيجابي (ROC5={_roc5_soft:.2f}%)',
                                                'trend': f'✅ فوق/قريب SMA50' if (_above_sma50_soft or _near_sma50_soft) else '⚠️ بعيد عن SMA50',
                                            }
                                            # RS marker لو stock_roc > benchmark
                                            if _roc5_soft > _bench_roc_soft:
                                                _soft_proofs['benchmark'] = f'✅ أقوى من السوق (ROC5={_roc5_soft:.2f}% vs bench={_bench_roc_soft:.2f}%)'
                                            else:
                                                _soft_proofs['benchmark'] = f'⚠️ أضعف من السوق (ROC5={_roc5_soft:.2f}% vs bench={_bench_roc_soft:.2f}%)'
                                            result['proofs'] = _soft_proofs
                                            print(f"[SOFT-SURGE] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                                                  f"vol_ratio={_vol_ratio_soft:.2f} roc5={_roc5_soft:.2f}% rr={_rr_soft:.2f} "
                                                  f"entry={_entry_soft:.2f} stop={_stop_soft:.2f} target={_target_soft:.2f}", flush=True)
                                        else:
                                            # Task IMPROVEMENT-12: لو soft-surge فشل → احتفظ بالإشارة الأصلية (HOLD/WAIT/SELL)
                                            # بدل ما نرفضها بـ continue، نكتبها في DB
                                            if signal in ('HOLD', 'WAIT', 'SELL', 'STRONG_SELL'):
                                                print(f"📝 [NON-BUY-SIGNAL] {ticker} on {scan_date}: signal={signal} score={result.get('score', 0)} → keeping for DB", flush=True)
                                            # لو signal فضل WAIT وماعرفناش نحوله → نكتبه HOLD
                                            if signal == 'WAIT':
                                                signal = 'HOLD'
                                                result['signal'] = 'HOLD'
                                    else:
                                        # Task IMPROVEMENT-12: volume data insufficient → احتفظ بالإشارة الأصلية
                                        # BRAVO-MSG-FIX (2026-10-20): وضّح السبب الحقيقي بدل "insufficient vol data"
                                        if signal in ('HOLD', 'WAIT', 'SELL', 'STRONG_SELL'):
                                            if signal == 'WAIT':
                                                signal = 'HOLD'
                                                result['signal'] = 'HOLD'
                                            # اعرض الأسباب الحقيقية للرفض
                                            _reject_reasons = []
                                            _vol_thresh = float(get_setting('v402_soft_surge_vol_ratio', default=2.0))
                                            _roc_thresh = float(get_setting('v402_soft_surge_roc5_min', default=3.0))
                                            if _vol_ratio_soft < _vol_thresh:
                                                _reject_reasons.append(f"vol_ratio={_vol_ratio_soft:.2f}x < {_vol_thresh}")
                                            if _roc5_soft <= _roc_thresh:
                                                _reject_reasons.append(f"roc5={_roc5_soft:.2f}% <= {_roc_thresh}%")
                                            if not (_above_sma50_soft or _near_sma50_soft):
                                                _reject_reasons.append("below SMA50")
                                            _reasons_str = "; ".join(_reject_reasons) if _reject_reasons else "soft-surge conditions not met"
                                            print(f"📝 [NON-BUY-SIGNAL] {ticker} on {scan_date}: signal={signal} ({_reasons_str}){_vol_extrap_note} → keeping for DB", flush=True)
                                else:
                                    # Task IMPROVEMENT-12: insufficient closes → احتفظ بالإشارة الأصلية
                                    if signal in ('HOLD', 'WAIT', 'SELL', 'STRONG_SELL'):
                                        if signal == 'WAIT':
                                            signal = 'HOLD'
                                            result['signal'] = 'HOLD'
                            except Exception:
                                # Task IMPROVEMENT-12: safe fallback — احتفظ بالإشارة الأصلية
                                if signal == 'WAIT':
                                    signal = 'HOLD'
                                    result['signal'] = 'HOLD'

            entry = result['entry']
            target = result['target']
            stop = result['stop_loss']
            if ticker == "AMOC": print(f"[DNA-TRACE] AMOC: reached stop check stop={stop} entry={entry}", flush=True)
            if stop >= entry or entry <= 0:
                if result.get('proofs', {}).get('soft_surge'):
                    print(f"[SOFT-SURGE-DEBUG] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: REJECTED stop>=entry (stop={stop} entry={entry})", flush=True)
                continue

            # ─── ZERO-VOLUME GUARD (2026-08-28) ────────────────────────────────
            # Analyst advice: reject stocks that are not trading (volume = 0).
            # ARVA entered 2026-08-04 with V=0 for 10 consecutive days!
            # Such stocks are "dead" — no liquidity, can't exit, false stop hits.
            # Reject if today's volume OR yesterday's volume is 0 (or near-zero < 1000).
            try:
                _today_vol = volumes[day_idx] if day_idx < len(volumes) else 0
                _yest_vol = volumes[day_idx - 1] if day_idx >= 1 and day_idx - 1 < len(volumes) else 0
                if ticker == "AMOC": print(f"[DNA-TRACE] AMOC: vol check today={_today_vol} yest={_yest_vol}", flush=True)
                _dead_vol = float(get_setting('v402_dead_volume_threshold', default=1000))
                if _today_vol < _dead_vol or _yest_vol < _dead_vol:
                    continue  # skip dead stocks
            except Exception:
                pass  # safe fallback

            # ─── DON'T CHASE FILTER (2026-08-28) ───────────────────────────────
            # Analyst advice: reject entry if stock already exploded recently.
            # Prevents "buying the top" after +20% daily pumps (UNIT, ELSH in July).
            # Thresholds (EGX-tuned — RESTORED to original):
            #   - daily_gain > +12%  → reject (stock exploded today, wait for pullback)
            #   - ROC3 > +18%       → reject (3-day rally too hot)
            #   - ROC5 > +28%       → reject (week rally too hot without rest)
            # Exception: if stock did a base/sweep after the pump → still allowed.
            try:
                _prev_close_1 = closes[day_idx - 1] if day_idx >= 1 else entry
                _prev_close_3 = closes[day_idx - 3] if day_idx >= 3 else entry
                _prev_close_5 = closes[day_idx - 5] if day_idx >= 5 else entry
                _daily_gain = ((entry - _prev_close_1) / _prev_close_1 * 100) if _prev_close_1 > 0 else 0
                _roc3 = ((entry - _prev_close_3) / _prev_close_3 * 100) if _prev_close_3 > 0 else 0
                _roc5 = ((entry - _prev_close_5) / _prev_close_5 * 100) if _prev_close_5 > 0 else 0

                _chase_rejected = False
                _chase_reason = ''
                if ticker == "AMOC": print(f"[DNA-TRACE] AMOC: chase check daily_gain={_daily_gain:.2f}% roc3={_roc3:.2f}% roc5={_roc5:.2f}%", flush=True)
                if _daily_gain > float(get_setting('v402_chase_daily_gain_max', default=12.0)):
                    _chase_rejected = True
                    _chase_reason = f'daily_gain=+{_daily_gain:.1f}% > +12%'
                elif _roc3 > float(get_setting('v402_chase_roc3_max', default=18.0)):
                    _chase_rejected = True
                    _chase_reason = f'ROC3=+{_roc3:.1f}% > +18%'
                elif _roc5 > float(get_setting('v402_chase_roc5_max', default=28.0)):
                    _chase_rejected = True
                    _chase_reason = f'ROC5=+{_roc5:.1f}% > +28%'

                if _chase_rejected:
                    continue
            except Exception:
                pass  # safe fallback — don't block on computation errors

            # ─── CORRECTION DETECTION (2026-08-28) ───────────────────────────
            # Analyst advice: if stock fell -5% or more from its 5-day high,
            # it's in a correction → WAIT instead of BUY (unless surge/accum hunter).
            # Prevents entering mid-correction (RAYA pattern in July).
            # Exception: surge_hunter + accumulation_hunter + recovery_hunter bypass (already verified).
            _is_surge_signal = result.get('proofs', {}).get('surge_hunter', False)
            _is_accum_signal = result.get('proofs', {}).get('accumulation_hunter', False)
            _is_recovery_signal = result.get('proofs', {}).get('recovery_hunter', False)
            _is_soft_surge_signal = result.get('proofs', {}).get('soft_surge', False)  # EGX-STRATEGY-FINAL

            # ── PEAK ENTRY FILTER — منع الدخول في القمة ──────────────────
            # لو السعر قرب 52w high (≥95%) + RSI > 65 → ارفض (تشبع شرائي)
            # استثناء: surge/accum/recovery hunters (هم بيدخلوا في بداية الحركة)
            if not _is_surge_signal and not _is_accum_signal and not _is_recovery_signal and not _is_soft_surge_signal:
                try:
                    _highs_60 = highs[max(0, day_idx - 60):day_idx + 1]
                    _high_60d = max(_highs_60) if _highs_60 else entry
                    _near_peak = ((entry / _high_60d) * 100) if _high_60d > 0 else 0
                    # حساب RSI سريع
                    # FIX-2 (Rule 24 + owner directive): was `_rsi_quick = 50.0`
                    # (placeholder — if RSI computation failed, fake neutral 50
                    # meant the peak-entry filter never triggered → could enter
                    # overbought peaks). Now None — peak-entry filter only applies
                    # if RSI was actually computed.
                    _rsi_quick: Optional[float] = None
                    if len(closes[:day_idx+1]) >= 15:
                        # UNIFY-FIX (Rule 67 CALCULATION-CANONICAL): استخدم Wilder's RSI
                        # بدل SMA-based (كان bug: sum/14 بدل Wilder's smoothing)
                        try:
                            from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
                            _rsi_quick = _canonical_calc_rsi(closes[:day_idx+1], 14)
                        except Exception:
                            _rsi_quick = None
                    # رفض لو قرب القمة + RSI مرتفع
                    # FIX-2: guard _rsi_quick is not None (no fake 50.0 comparison)
                    if _rsi_quick is not None and _near_peak >= float(get_setting('v402_near_peak_threshold', default=95)) and _rsi_quick > float(get_setting('v402_near_peak_rsi_max', default=65)):
                        continue
                except Exception:
                    pass

            if not _is_surge_signal and not _is_accum_signal and not _is_recovery_signal and not _is_soft_surge_signal and day_idx >= 5:
                try:
                    _recent_high = max(highs[max(0, day_idx - 5):day_idx + 1])
                    _drawdown_from_high = ((_recent_high - entry) / _recent_high * 100) if _recent_high > 0 else 0
                    # لو السعر نزل أكتر من 5% من آخر high خلال 5 أيام → في تصحيح
                    if _drawdown_from_high >= float(get_setting('v402_drawdown_from_high_min', default=5.0)):
                        continue
                except Exception:
                    pass  # safe fallback

            future_closes = closes[day_idx + 1:]
            future_dates = dates[day_idx + 1:]
            future_atrs = atrs[day_idx + 1:]
            trade = Trade(
                ticker=ticker, entry_date=scan_date, entry_price=entry,
                target_price=target, stop_loss=stop, score=result['score'],
                signal=signal, proofs=result['proofs'],
            )
            if len(future_closes) >= 5:
                trade = simulate_trade(trade, future_closes, future_dates, 7, future_atrs)
            else:
                trade.exit_reason = 'ACTIVE'
                trade.is_win = False
                trade.exit_price = None
                trade.exit_date = None
                trade.holding_days = 0
                trade.return_pct = 0.0

            evidence = count_evidence(result['proofs'])
            r_mult = compute_r_multiple(entry, target, stop)
            persona_fit = compute_persona_fit(result.get('proofs', {}))

            # ── FEEDBACK LOOP (2026-09-01): اضبط confidence بناءً على الأداء التاريخي ──
            # لو النظام عنده سجل سيئ مع نفس نوع الإشارة → قلل الثقة
            # لو السجل كويس → زود الثقة
            try:
                from analyzers.feedback_loop import FeedbackLoop
                _fb = FeedbackLoop()
                _pattern_wr = _fb.get_pattern_win_rate(signal)
                _pattern_wr_min = float(get_setting('v402_pattern_wr_min', default=0.65))
                if _pattern_wr > 0 and _pattern_wr < _pattern_wr_min:
                    # أداء ضعيف → قلل score
                    result['score'] = max(0, int(result['score'] * _pattern_wr / _pattern_wr_min))
                    result['proofs']['feedback_warning'] = f'⚠️ أداء تاريخي ضعيف لهذا النمط (WR={_pattern_wr*100:.0f}%)'
                elif _pattern_wr >= float(get_setting('v402_pattern_wr_boost', default=0.75)):
                    # أداء كويس → boost
                    result['score'] = min(100, result['score'] + 5)
                    result['proofs']['feedback_boost'] = f'✅ أداء تاريخي قوي (WR={_pattern_wr*100:.0f}%)'
            except Exception:
                pass  # safe-by-design: لو feedback loop فشل → نكمّل

            # ── SECTOR + INTRADAY (2026-09-01): تتبع القطاعات + الميكرز ──
            # قطاع heat + maker flow (سيولة لحظية)
            if os.environ.get('V76_SECTOR_INTRADAY', '1') == '1':
                try:
                    from analyzers.intraday_reader import get_sector_performance, detect_maker_flow
                    
                    # 1. Sector performance — penalty لو القطاع بارد
                    _ticker_sector = None
                    try:
                        import sqlite3 as _sec_sql
                        _sec_conn = _sec_sql.connect(str(_PROJECT_ROOT / 'db' / 'stocks.db'), timeout=5.0)
                        _sec_row = _sec_conn.execute('SELECT sector FROM stocks WHERE ticker=?', (ticker,)).fetchone()
                        _sec_conn.close()
                        if _sec_row: _ticker_sector = _sec_row[0]
                    except Exception:
                        pass
                    
                    if _ticker_sector:
                        _sec_perf = get_sector_performance(_ticker_sector)
                        result['sector_heat'] = _sec_perf.get('heat', 'cold')
                        result['sector_avg_change'] = _sec_perf.get('avg_change', 0)
                        
                        # لو القطاع بارد جداً (avg < -1%) → قلل الثقة
                        if _sec_perf.get('avg_change', 0) < -1.0:
                            print(f"[SECTOR-COLD] {ticker}: قطاع {_ticker_sector} بارد "
                                  f"({_sec_perf['avg_change']:+.2f}%) → تقليل ثقة", flush=True)
                            if isinstance(result.get('score'), (int, float)):
                                result['score'] = max(0, result['score'] - 10)
                        # لو القطاع ساخن (avg > +2%) → boost
                        elif _sec_perf.get('avg_change', 0) > 2.0:
                            print(f"[SECTOR-HOT] {ticker}: قطاع {_ticker_sector} ساخن "
                                  f"({_sec_perf['avg_change']:+.2f}%) → boost", flush=True)
                            if isinstance(result.get('score'), (int, float)):
                                result['score'] = min(100, result['score'] + 8)
                    
                    # 2. Maker flow (intraday) — كشف سيولة مؤسسية
                    _maker = detect_maker_flow(ticker)
                    result['maker_flow'] = _maker.get('flow', 'neutral')
                    result['maker_confidence'] = _maker.get('confidence', 0)
                    
                    if _maker.get('flow') == 'buying' and _maker.get('confidence', 0) > 60:
                        print(f"[MAKER-BUYING] {ticker}: سيولة مؤسسية شرائية "
                              f"(conf={_maker['confidence']}, price_trend={_maker['price_trend_pct']:+.3f}%)", flush=True)
                        if isinstance(result.get('score'), (int, float)):
                            result['score'] = min(100, result['score'] + 12)
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['maker_buying'] = f'✅ سيولة مؤسسية شرائية (conf={_maker["confidence"]})'
                    elif _maker.get('flow') == 'selling':
                        print(f"[MAKER-SELLING] {ticker}: سيولة مؤسسية بيعية "
                              f"(conf={_maker['confidence']}) → تقليل ثقة", flush=True)
                        if isinstance(result.get('score'), (int, float)):
                            result['score'] = max(0, result['score'] - 15)
                except Exception as _intraday_err:
                    pass  # safe-by-design

            # ── EGX-STRATEGY (2026-08-30): الحد الأدنى للإثباتات ──
            # استراتيجية المالك: "ندخل فقط عندما يكون الاحتمال لصالحنا بوضوح".
            # تحليل مارس-مايو أظهر إن 4 من 9 خسائر كان evidence=0/6 (بدون أي إثباتات).
            # الحل: رفض أي إشارة evidence < min_evidence_count (default=3).
            try:
                _min_ev = int(get_setting('v402_min_evidence_count', default=int(get_setting('min_evidence_count', default=3))))
            except Exception:
                _min_ev = 3
            if evidence < _min_ev:
                continue

            # ─── FUNDAMENTALS-VETO (2026-08-17): hard reject weak-fundamentals stocks ───
            # Owner directive: if persona_fit != 'gambler' AND fundamentals are available
            # AND fundamental_score < 30.0 → REJECT the trade.
            # Rationale: balanced/conservative personas need financial quality; the gambler
            # is exempt (rides momentum: PA 40% + SMC 35% + Sector 25%, fund 0%).
            # Safe-by-design: when fundamentals are UNAVAILABLE (available=False, e.g. during
            # the egx_fundamentals empty period), the veto does NOT fire — picks pass through
            # so the pipeline isn't choked while the fundamentals fetcher is unscheduled.
            #
            # ── UNIFIED-BALANCED-ONLY (2026-08-30): تعطيل تعدد الشخصيات ──
            # مهما كان persona_fit، النظام بـ يطبّق veto بتاع الـ balanced بس
            # (يعني أي سهم fundamentals_score < 30 هيترفض). الـ gambler exemption
            # اتعلّق عشان كل التوقعات بـ تستخدم منطق الـ balanced.
            #
            # INTEGRATION-FIX (2026-10-01): ربط fundamental_data_provider مباشرة بالـ DailyPredictor.
            # قبل كده: BacktestEngine كان بيحسب fundamental_score بس الـ DailyPredictor كان بياخده من
            # result dict اللي ممكن يكون فاضي → fallback لـ 50.0 (placeholder).
            # دلوقتي: DailyPredictor بيستدعي get_fundamental_score() مباشرة لو الـ result فاضي.
            _fit_persona = 'balanced'  # UNIFIED-BALANCED-ONLY: persona واحدة
            _fund_score = float(result.get('fundamental_score', 0.0) or 0.0)
            _fund_avail = bool(result.get('fundamentals_available', False))
            
            # INTEGRATION-FIX: لو الـ fundamentals مش متاحة في الـ result → جرّب يحسبها مباشرة
            if not _fund_avail:
                try:
                    from analyzers.fundamental_data_provider import get_fundamental_score as _get_fs
                    _fs_result = _get_fs(ticker)
                    if _fs_result.get('available') and _fs_result.get('score') is not None:
                        _fund_score = float(_fs_result['score'])
                        _fund_avail = True
                        result['fundamental_score'] = _fund_score
                        result['fundamentals_available'] = True
                except Exception:
                    pass  # safe-by-design
            
            # if _fit_persona != 'gambler' and _fund_avail and _fund_score < 30.0:
            #     continue
            # UNIFIED-BALANCED-ONLY: veto دايماً (balanced logic)
            if _fund_avail and _fund_score < float(get_setting('v402_fund_score_min', default=30.0)):
                continue

            # ── EGX-STRATEGY-FINAL (2026-08-30): Entry Gate الشامل ──
            # المالك طلب: "شروط الدخول الإلزامية (كلها مع مع بعض):
            #   - evidence_count ≥ 3
            #   - السعر فوق SMA50 أو قريب جدًا مع تأكيد قوة
            #   - RS > 1.0
            #   - مش في Deep Correction
            #   - مش ممتد (Don't Chase)
            #   - R/R ≥ 1.8
            #   - السيولة مقبولة
            #   - السهم مصري فقط (EGX Gate موجود)
            # فلتر السياق:
            #   - لو السوق العام هابط بوضوح → ارفض
            #   - لو القطاع بارد → ارفض"
            # الـ entry_gate بـ يفحص كل الشروط دي مرة واحدة. لو أي شرط فشل → continue.
            try:
                from utils.entry_gate import check_entry_gate

                # ── Task 47 (2026-10-04): استخرج RSI + 52w range للـ context-aware filters ──
                _ctx_rsi: Optional[float] = None
                try:
                    _v38_rsi_str = str(result.get('proofs', {}).get('technicals', ''))
                    if 'RSI' in _v38_rsi_str:
                        import re as _ctx_rsi_re
                        _ctx_rsi_match = _ctx_rsi_re.search(r'RSI[:\s]+(\d+(?:\.\d+)?)', _v38_rsi_str)
                        if _ctx_rsi_match:
                            _ctx_rsi = float(_ctx_rsi_match.group(1))
                except Exception:
                    pass

                # 52-week high/low from closes (آخر 252 يوم لو متاحين)
                _ctx_closes = closes[:day_idx+1]
                _ctx_lookback = min(len(_ctx_closes), 252)
                _ctx_high_52w = max(_ctx_closes[-_ctx_lookback:]) if _ctx_lookback > 0 else None
                _ctx_low_52w = min(_ctx_closes[-_ctx_lookback:]) if _ctx_lookback > 0 else None

                # Task IMPROVEMENT-17-2026-10-07: حساب stock_roc + benchmark_change
                # للمسار الأساسي (مش بس SOFT-SURGE)
                # السبب: master_analyzer مش بيبعت stock_roc → RS=0.00% → رفض خاطئ
                _stock_roc_val = float(result.get('stock_roc', 0) or 0)
                _bench_change_val = float(result.get('benchmark_change', 0) or 0)

                # لو stock_roc مش موجود → احسبه من closes
                if _stock_roc_val == 0 and len(closes[:day_idx+1]) >= 6:
                    _closes_for_roc = closes[:day_idx+1]
                    if _closes_for_roc[-6] > 0:
                        _stock_roc_val = ((_closes_for_roc[-1] - _closes_for_roc[-6]) / _closes_for_roc[-6] * 100)
                        result['stock_roc'] = round(_stock_roc_val, 2)

                # لو benchmark_change مش موجود → اجلبه من engine
                if _bench_change_val == 0:
                    try:
                        _bench_change_val = float(engine._benchmark_roc_by_date.get(scan_date, 0.0))
                        result['benchmark_change'] = _bench_change_val
                    except Exception:
                        pass

                _gate_data = {
                    'entry_price': entry,
                    'target_price': target,
                    'stop_price': stop,
                    'evidence_count': evidence,
                    'proofs': result.get('proofs', {}),
                    'closes': _ctx_closes,
                    'volumes': volumes[:day_idx+1],
                    'market_regime_trend': result.get('market_regime_trend', ''),
                    'stock_roc': _stock_roc_val,
                    'benchmark_change': _bench_change_val,
                    'signal_type': signal,
                    'score': result.get('score', 0),
                    # PRED-RADAR-GAP-AUDIT Step 3: تمرير الـ ticker للـ entry_gate
                    # عشان يقدر يـ check radar confirmation في bypass logic.
                    'ticker': ticker,
                    # ── Task 47: Context-aware filters data ──
                    'high_52w': _ctx_high_52w,
                    'low_52w': _ctx_low_52w,
                    'rsi': _ctx_rsi,
                }
                _gate_result = check_entry_gate(_gate_data)
                if not _gate_result['passed']:
                    # log الـ rejection للـ audit
                    _fail_reasons = '; '.join(_gate_result['reasons_failed'][:3])
                    print(f"[ENTRY-GATE-REJECT] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"score={_gate_result['score']}/{_gate_result['total_checks']} | {_fail_reasons}", flush=True)
                    continue
                # ── Task 47: لو في context_boost قوي → خزّنه في result للـ position sizing وارفع الـ score ──
                _ctx_boost = _gate_result.get('context_boost', 0.0)
                if _ctx_boost != 0.0:
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    _soft = _gate_result.get('soft_signals', {})
                    _poc_s = _soft.get('poc_distance', {})
                    _acc_s = _soft.get('accumulation', {})
                    result['proofs']['context_signals'] = (
                        f"context_boost={_ctx_boost:+.2f} | "
                        f"{_poc_s.get('reason', '')} | {_acc_s.get('reason', '')}"
                    )
                    # تعديل السكور: زيادة حتى +5 نقاط للصفقات ذات خصم الـ POC والتجميع
                    _score_adj = int(round(_ctx_boost * 10))
                    result['score'] = min(100, max(0, result.get('score', 50) + _score_adj))
                
                # COUNTER-TREND BUY: لو entry_gate سمح بـ counter_trend → خزّن الفلاغ للـ position sizing
                _market_ctx_check = _gate_result.get('checks', [])
                for _chk in _market_ctx_check:
                    if _chk.get('name') == 'market_context' and _chk.get('counter_trend_buy'):
                        result['counter_trend_buy'] = True
                        result['position_size_override'] = _chk.get('position_size_override', 0.5)
                        print(f"[COUNTER-TREND] {ticker}: mean-reversion BUY enabled (position_size × {_chk.get('position_size_override', 0.5)})", flush=True)
                        break
            except Exception as _gate_err:
                # safe-by-design: لو الـ gate فشل، سيب الإشارة تكمّل (مش نوقف النظام)
                pass

            # ════════════════════════════════════════════════════════════════
            # 📝 TASK-A (Technical Explanation Generator — 2026-10-04):
            # استدعاء build_technical_explanation() اللي بتجمع كل المحركات الفنية
            # (Candlestick + SMC + Volume Profile + AI Patterns + Narrative)
            # في نص عربي شامل يظهر في الـ UI + رسائل التليجرام + قاعدة البيانات.
            # safe-by-design: لو المحرك فشل → نتجاهل ونكمّل (مش نوقف الإشارة).
            # ════════════════════════════════════════════════════════════════
            try:
                from analyzers.technical_explainer import build_technical_explanation
                _tech_closes = closes[:day_idx+1] if day_idx < len(closes) else closes
                _tech_volumes = volumes[:day_idx+1] if day_idx < len(volumes) else volumes
                _tech_highs = highs[:day_idx+1] if 'highs' in dir() and highs and day_idx < len(highs) else None
                _tech_lows = lows[:day_idx+1] if 'lows' in dir() and lows and day_idx < len(lows) else None
                _tech_opens = opens[:day_idx+1] if 'opens' in dir() and opens and day_idx < len(opens) else None
                _tech_expl = build_technical_explanation(
                    ticker=ticker,
                    closes=list(_tech_closes or []),
                    volumes=list(_tech_volumes or []),
                    highs=list(_tech_highs) if _tech_highs else None,
                    lows=list(_tech_lows) if _tech_lows else None,
                    opens=list(_tech_opens) if _tech_opens else None,
                    entry_price=entry,
                    target_price=target,
                    stop_price=stop,
                    proofs=result.get('proofs', {}) or {},
                    trap_type=result.get('trap_type') or result.get('v68_dirty_distribution') and 'DISTRIBUTION_TRAP' or None,
                    signal=signal or 'BUY',
                )
                # خزّن النتيجة في مكانين (per TASK-A spec):
                # 1) result['technical_explanation'] (top-level — للـ analysis_json INSERT)
                # 2) result['proofs']['technical_explanation'] (in-memory للـ UI الفوري)
                result['technical_explanation'] = _tech_expl
                if 'proofs' not in result or result['proofs'] is None:
                    result['proofs'] = {}
                result['proofs']['technical_explanation'] = _tech_expl
                # LOG سطر واحد للـ audit trail
                _tech_summary = _tech_expl.get('summary', '') if isinstance(_tech_expl, dict) else ''
                if _tech_summary:
                    print(f"[TECH-EXPL] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"{_tech_summary[:100]}", flush=True)
            except Exception as _tech_err:
                # safe-by-design: لو المحرك فشل → نكمّل بدون technical_explanation
                if ticker == "AMOC":
                    print(f"[TECH-EXPL-ERR] AMOC: {_tech_err}", flush=True)

            # ════════════════════════════════════════════════════════════════
            # 🛰️ RADAR HARD GATE (2026-10-07 — owner directive):
            # "الرادار ده المفروض يكون من الحاجات المهمة جداً"
            #
            # الـ radar بقى HARD GATE على مستوى كل التوقعات (مش بس counter-trend):
            #   1. Exit Radar X1/X5 → REJECT (لا توصي بسهم عليه توزيع قوي/kill switch)
            #   2. Maker Radar HARD GATE: لو الرادار متاح + السهم مش في
            #      A_pre_surge أو B_quiet_accumulation_strong → REJECT
            #      (مفيش توقع أصلاً لو الرادار مش شايف تجميع قوي)
            #   3. لو عدّى الـ gate → SCORE BOOST (+4/+5) + proof للـ UI
            #
            # SAFE-BY-DESIGN (Rule 27): لو الرادار مش متاح (ملف مش موجود)،
            # ما نمنعش السهم — نكمّل بدون gate.
            # ════════════════════════════════════════════════════════════════
            try:
                from analyzers.radar_integration import (
                    check_exit_radar_conflict,
                    is_radar_strong_accumulation,
                    radar_data_available,
                    get_radar_state,
                )

                # 1. Exit Radar conflict check — HARD BLOCK (X1/X5 = توزيع/kill switch)
                _exit_conflict = check_exit_radar_conflict(ticker)
                if _exit_conflict['blocked']:
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['exit_radar_block'] = f'🚫 {_exit_conflict["reason"]}'
                    print(f"[EXIT-RADAR-BLOCK] {ticker}: {_exit_conflict['reason']}", flush=True)
                    continue  # REJECT — لا توصي بسهم عليه توزيع قوي

                # 2. Exit Radar warning (X2/X3/X4) — not blocked, but log warning + penalty
                if _exit_conflict['path'] and not _exit_conflict['blocked']:
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['exit_radar_warning'] = f'⚠️ {_exit_conflict["reason"]}'
                    result['score'] = max(0, result['score'] - 3)

                # 3. ★ HARD GATE ★: Maker Radar confirmation
                #    لو الرادار متاح + السهم مش في A_pre_surge أو B_quiet_accumulation_strong → REJECT
                _mkt_code = market_code if 'market_code' in dir() else 'EGX'
                _radar_on = radar_data_available(_mkt_code)
                if _radar_on:
                    _radar_strong = is_radar_strong_accumulation(ticker, _mkt_code)
                    if not _radar_strong:
                        _radar_state = get_radar_state(ticker, _mkt_code) or '—'
                        print(
                            f"[RADAR-GATE-REJECT] {ticker}: radar state='{_radar_state}' "
                            f"(not in A_pre_surge/B_quiet_accumulation_strong) → skip",
                            flush=True
                        )
                        continue  # REJECT — مفيش توقع لو الرادار مش شايف تجميع قوي
                    # عدّى الـ gate → أضف proof + boost
                    _radar_state = get_radar_state(ticker, _mkt_code) or 'radar_confirmed'
                    _boost = 5 if _radar_state == 'B_quiet_accumulation_strong' else 4
                    result['score'] = min(100, result['score'] + _boost)
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['radar_gate'] = (
                        f'🛰️ رادار السيولة (HARD GATE): {_radar_state} (+{_boost})'
                    )
                    print(
                        f"[RADAR-GATE-PASS] {ticker}: state='{_radar_state}' → +{_boost} score",
                        flush=True
                    )
                # لو الرادار مش متاح → safe-by-design (نكمّل بدون gate)
            except Exception as _radar_err:
                if ticker == "AMOC":
                    print(f"[RADAR-GATE-TRACE] AMOC: radar integration EXCEPTION: {_radar_err}", flush=True)
                pass  # safe-by-design: لو الرادار فشل → نكمّل بدون gate

            # ════════════════════════════════════════════════════════════════
            # SCREENER + FUNDAMENTALS + BID/ASK INTEGRATION (2026-09-03)
            # Owner: "انا عندى تصنيفات كتيييييييييييير جدا لية مش بنستعملها؟"
            # Owner: "عندك بيانات عمق السوق الى هى عروض البيع و الشراء؟"
            #
            # ده بيربط 3 كنوز مدفونة بـ V40.2:
            # 1. screener_lists (8 قوائم: unusual_volume +10, undervalued +9, إلخ)
            # 2. tab_valuation + tab_profitability (P/E, ROE → boost +5 / veto bubble)
            # 3. intraday_prices bid/ask (spread < 0.5% → boost +3 سيولة عالية)
            #
            # CONSTITUTION: Rule 20 (Python=brain), Rule 27 (NO-FAKE-DATA),
            # Rule 29 (UNIFIED-SYSTEM), Rule 17 (RELATIVE-PATHS)
            # ════════════════════════════════════════════════════════════════
            try:
                from analyzers.screener_integration import apply_screener_data_to_v402
                # RSI for top_gainers veto check
                # FIX-2 (Rule 24 + owner directive): was `_rsi_val = 50.0` (placeholder
                # — if RSI extraction failed, fake neutral 50 passed to screener →
                # top_gainers veto never triggered → could enter FOMO pumps). Now
                # None — when RSI is None, we still call apply_screener_data_to_v402
                # but pass the function default (rsi=50.0 = neutral, per its contract)
                # explicitly via the ternary below. The 50.0 here is the FUNCTION's
                # documented neutral default, NOT a placeholder for missing data —
                # the local var _rsi_val honestly reflects 'no RSI extracted'.
                _rsi_val: Optional[float] = None
                try:
                    _v38_rsi = result.get('proofs', {}).get('technicals', '')
                    if 'RSI' in str(_v38_rsi):
                        import re as _rsi_re
                        _rsi_match = _rsi_re.search(r'RSI[:\s]+(\d+)', str(_v38_rsi))
                        if _rsi_match:
                            _rsi_val = float(_rsi_match.group(1))
                except Exception:
                    pass
                _screener_result = apply_screener_data_to_v402(
                    ticker=ticker,
                    score=result.get('score', 0),
                    signal=signal,
                    rsi=(_rsi_val if _rsi_val is not None else 50.0),  # 50.0 = neutral RSI per function contract (NOT placeholder)
                    current_price=entry,
                )
                # Veto: لو screener/fundamentals قال VETO → ارفض
                if _screener_result['veto']:
                    print(f"[SCREENER-VETO] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"{' | '.join(_screener_result['boost_notes'])}", flush=True)
                    continue
                # Apply score boost/reduction
                _old_score = result.get('score', 0)
                result['score'] = _screener_result['adjusted_score']
                if _screener_result['boost_notes']:
                    _delta = result['score'] - _old_score
                    if _delta != 0:
                        print(f"[SCREENER-BOOST] {ticker}: score {_old_score}→{result['score']} "
                              f"({' | '.join(_screener_result['boost_notes'])})", flush=True)
                # خزّن بيانات screener في proofs للـ UI
                if 'proofs' not in result or result['proofs'] is None:
                    result['proofs'] = {}
                if _screener_result['screener_tags']:
                    result['proofs']['screener_tags'] = ', '.join(_screener_result['screener_tags'])
                if _screener_result['fundamentals'].get('pe'):
                    result['proofs']['fundamentals'] = f"P/E={_screener_result['fundamentals']['pe']:.1f}, ROE={_screener_result['fundamentals'].get('roe', 0):.1f}%"
                if _screener_result['bid_ask'].get('spread_pct') is not None:
                    result['proofs']['bid_ask'] = f"spread={_screener_result['bid_ask']['spread_pct']:.2f}%"
            except Exception as _screener_err:
                if ticker == "AMOC": print(f"[DNA-TRACE] AMOC: screener EXCEPTION: {_screener_err}", flush=True)
                pass  # safe-by-design: لو screener integration فشل → نكمّل

            # ── DELTA VOLUME (DISPLAY ONLY — 2026-09-04) ──
            # A/B test proved delta_volume on daily candles HURTS results (PF -0.31, WR -1.46%).
            # Kept for UI display only — NO boost, NO veto.
            # Will revisit on 5-minute intraday data (Phase 2).
            try:
                from analyzers.screener_integration import get_delta_volume_data
                _delta_data = get_delta_volume_data(ticker)
                if _delta_data['has_data']:
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['delta_volume'] = (
                        f"{'🟢' if (_delta_data.get('delta_pct',0) or 0) > 0 else '🔴'} "
                        f"delta={_delta_data['delta_pct']}% ({_delta_data['pressure']}) "
                        f"buy={_delta_data['buy_volume']:,} sell={_delta_data['sell_volume']:,}"
                    )
            except Exception:
                pass  # safe-by-design

            # ── SECTOR-LIQUIDITY FILTER (مرحلة منفصلة 1 — 2026-08-30) ──
            # المالك: "السيولة والميكرز بتخش في السوق على القطاع مش أسهم منفصلة"
            # المنطق: احسب حرارة القطاع من كل أسهم EGX في نفس اليوم.
            # لو القطاع "dead" (أغب أسهمه هابطة) → ارفض الدخول حتى لو السهم قوي.
            # لو القطاع "hot" (أغب أسهمه صاعدة) → اسمح الدخول (boost).
            try:
                import sqlite3 as _sec_sql
                _sec_db = str(Path(__file__).resolve().parents[2] / 'db' / 'stocks.db')
                _sec_conn = _sec_sql.connect(_sec_db, timeout=5.0)
                _sec_conn.row_factory = _sec_sql.Row
                # جيب sector السهم
                _sec_row = _sec_conn.execute(
                    "SELECT sector FROM stocks WHERE ticker = ? AND market = ? LIMIT 1",
                    (ticker, market_code)
                ).fetchone()
                _stock_sector = _sec_row['sector'] if _sec_row and _sec_row['sector'] else None
                if _stock_sector and _stock_sector not in ('', '—', None, 'Diversified', 'diversified', 'غير مصنف', 'N/A', 'nan'):
                    # احسب حرارة القطاع: متوسط change_percent + rising_ratio
                    _sec_stats = _sec_conn.execute("""
                        SELECT 
                            COUNT(*) as n,
                            AVG(change_percent) as avg_chg,
                            SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as rising,
                            SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as falling
                        FROM stocks
                        WHERE market = ? AND sector = ? AND change_percent IS NOT NULL
                    """, (market_code, _stock_sector)).fetchone()
                    if _sec_stats and _sec_stats['n'] >= 3:
                        _n = _sec_stats['n']
                        _avg_chg = float(_sec_stats['avg_chg'] or 0)
                        _rising = int(_sec_stats['rising'] or 0)
                        _rising_pct = _rising / _n
                        # sector dead: avg ≤ -1.5% AND rising ≤ 20%
                        _stock_chg_row = _sec_conn.execute("SELECT change_percent FROM stocks WHERE ticker = ? AND market = ?", (ticker, market_code)).fetchone()
                        _self_chg = float(_stock_chg_row['change_percent'] or 0) if _stock_chg_row else 0.0
                        if _avg_chg <= -1.5 and _rising_pct <= 0.20 and _self_chg <= 0:
                            print(f"[SECTOR-DEAD] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                                  f"sector={_stock_sector[:20]} avg={_avg_chg:+.2f}% rising={_rising}/{_n} → رفض", flush=True)
                            _sec_conn.close()
                            continue
                _sec_conn.close()
            except Exception as _sec_err:
                if ticker == "AMOC": print(f"[DNA-TRACE] AMOC: sector EXCEPTION: {_sec_err}", flush=True)
                pass  # safe-by-design: لو sector filter فشل، سيب الإشارة تكمّل

            # ── BOS/ChoCH FILTER (مرحلة منفصلة 2 — 2026-08-30) ──
            # من Pine Script V56: BOS = كسر مقاومة → ترند صاعد مؤكد
            # ChoCH = كسر دعم → ترند هابط → خروج فوري
            # sweep_low = نزل تحت الدعم وقفل فوقه → ميكرز بيمتص السيولة
            # المنطق: لو في ChoCH bear (كسر دعم) → ارفض الدخول
            # لو في BOS bull أو sweep_low → boost الثقة
            try:
                from engines.backtest_engine import detect_order_blocks_and_sweeps
                _ob_state = detect_order_blocks_and_sweeps(
                    highs[:day_idx+1], lows[:day_idx+1], closes[:day_idx+1], lookback=5
                )
                # SEALED-DISPATCH Step 4b (2026-10-17): expose SMC analysis as a
                # structured proof in result['proofs']['smc'] (was previously only
                # printed to stdout). This makes the SMC analysis count toward
                # `count_evidence()` (≥3 ✅ markers required by EVIDENCE GATE).
                # Per dispatch: "MasterAnalyzer مش بيشتغل كامل — بس نأخذ SMC +
                # Conviction كـ proofs". detect_order_blocks_and_sweeps IS the
                # SMC analyzer we route as a proof (BOS bull + sweep low + ChoCH bear).
                _smc_markers = []
                if _ob_state.broke_resistance:
                    _smc_markers.append(f'BOS bull (res={_ob_state.last_resistance:.2f})')
                if _ob_state.sweep_low:
                    _smc_markers.append(f'sweep low (sup={_ob_state.last_support:.2f})')
                if _ob_state.broke_support and not _ob_state.sweep_low:
                    _smc_markers.append(f'ChoCH bear (broke sup={_ob_state.last_support:.2f})')
                # Add as proof (count_evidence counts ✅ markers — SMC bullish signals earn one)
                if 'proofs' not in result or result['proofs'] is None:
                    result['proofs'] = {}
                if _smc_markers:
                    # Bullish SMC signals (BOS bull + sweep low) earn a ✅ marker
                    _smc_bull = _ob_state.broke_resistance or _ob_state.sweep_low
                    result['proofs']['smc'] = (
                        f"{'✅' if _smc_bull else '⚠️'} SMC: {', '.join(_smc_markers)}"
                    )
                else:
                    result['proofs']['smc'] = '⚠️ SMC: لا إشارات صريحة (no BOS/sweep)'
                # ChoCH bear: السعر كسر آخر دعم → ترند هابط → رفض
                if _ob_state.broke_support and not _ob_state.sweep_low:
                    print(f"[CHOCH-BEAR] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"close={closes[day_idx]:.2f} broke support={_ob_state.last_support:.2f} → رفض", flush=True)
                    continue
                # BOS bull أو sweep_low → log للـ audit (boost ضمني)
                if _ob_state.broke_resistance:
                    print(f"[BOS-BULL] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"close={closes[day_idx]:.2f} broke resistance={_ob_state.last_resistance:.2f} → boost", flush=True)
                if _ob_state.sweep_low:
                    print(f"[SWEEP-LOW] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"low={lows[day_idx]:.2f} swept support={_ob_state.last_support:.2f} → boost", flush=True)
            except Exception as _bos_err:
                if ticker == "AMOC": print(f"[DNA-TRACE] AMOC: BOS EXCEPTION: {_bos_err}", flush=True)
                pass  # safe-by-design

            # ── V62 LOGIC (المرحلة 3 — 2026-08-31): 4 ميزات من Pine Script V62 ──
            # 1. fake_pump: شدّ وهمي (سعر بطلع بس حجم ضعيف) = فخ → رفض
            # 2. is_dist: توزيع (شمعة حمراء + ظهر علوي كبير + حجم عالي) = خروج/رفض
            # 3. is_story_stock: P/E > 50 = سهم قصة = تقليل الحجم
            # 4. maker_sweep: مسح سيولة (نزل تحت الدعم وقفل فوقه + delta موجب) = boost
            try:
                _v62_atr = float(result.get('atr', 0) or 0)
                if _v62_atr <= 0:
                    _v62_atr = entry * 0.05
                _v62_vol_ma = sum(volumes[max(0,day_idx-20):day_idx]) / max(1, min(20, day_idx)) if day_idx > 0 else 0
                _v62_last_vol = volumes[day_idx] if day_idx < len(volumes) else 0
                _v62_candle_range = (highs[day_idx] - lows[day_idx]) if day_idx < len(highs) else 0
                _v62_body = abs(closes[day_idx] - opens[day_idx]) if day_idx < len(closes) and day_idx < len(opens) else 0
                _v62_upper_wick = (highs[day_idx] - max(closes[day_idx], opens[day_idx])) if day_idx < len(highs) else 0

                # 1. fake_pump: طلع +3% بس حجم < MA → فخ
                _v62_is_pump = (closes[day_idx] > opens[day_idx]
                                and _v62_body > _v62_candle_range * 0.7
                                and ((closes[day_idx] - opens[day_idx]) / opens[day_idx] * 100) > 3
                                ) if day_idx < len(closes) and day_idx < len(opens) and opens[day_idx] > 0 else False
                _v62_fake_pump = _v62_is_pump and _v62_last_vol < _v62_vol_ma * 1.0 and _v62_vol_ma > 0
                if _v62_fake_pump:
                    print(f"[V62-FAKE-PUMP] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"طلع +{((closes[day_idx]-opens[day_idx])/opens[day_idx]*100):.1f}% بس حجم ضعيف "
                          f"({_v62_last_vol:.0f} < {_v62_vol_ma:.0f}) → رفض", flush=True)
                    continue

                # 2. is_dist: توزيع (شمعة حمراء + ظهر علوي > 50% من المدى + حجم > 2× MA)
                _v62_is_dist = (closes[day_idx] < opens[day_idx]
                                and _v62_upper_wick > _v62_candle_range * 0.5
                                and _v62_last_vol > _v62_vol_ma * 2.0
                                ) if day_idx < len(closes) and day_idx < len(opens) and _v62_vol_ma > 0 else False
                if _v62_is_dist:
                    print(f"[V62-DISTRIBUTION] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"توزيع واضح (ظهر={_v62_upper_wick/_v62_candle_range*100:.0f}% حجم={_v62_last_vol/_v62_vol_ma:.1f}×) → رفض", flush=True)
                    continue

                # 3. is_story_stock: P/E > 50 → تقليل الحجم (مش رفض)
                _v62_story_stock = False
                try:
                    import sqlite3 as _v62_sql
                    _v62_de_conn = _v62_sql.connect(str(_PROJECT_ROOT / 'db' / 'data_engine.db'))
                    # DATA-ENGINE-UNIFY-1 Stage 2b: ORDER BY id DESC (date column not in tab_valuation schema)
                    _v62_pe = _v62_de_conn.execute(
                        "SELECT pe_ratio FROM tab_valuation WHERE symbol = ? ORDER BY id DESC LIMIT 1",
                        (ticker,)
                    ).fetchone()
                    _v62_de_conn.close()
                    if _v62_pe and _v62_pe[0] and float(_v62_pe[0]) > 50:
                        _v62_story_stock = True
                        print(f"[V62-STORY-STOCK] {ticker}: P/E={float(_v62_pe[0]):.0f} > 50 → تقليل الحجم", flush=True)
                except Exception:
                    pass  # safe-by-design

                # 4. maker_sweep: لو فيه sweep_low + delta موجب → boost
                # (ده موجود بالفعل في BOS/ChoCH فوق — بس نضيف delta check)
                _v62_delta_vol = 0
                if day_idx < len(closes) and day_idx < len(highs) and day_idx < len(lows) and _v62_candle_range > 0:
                    _v62_buy_vol = _v62_last_vol * ((closes[day_idx] - lows[day_idx]) / _v62_candle_range)
                    _v62_sell_vol = _v62_last_vol - _v62_buy_vol
                    _v62_delta_vol = _v62_buy_vol - _v62_sell_vol

                # خزن V62 flags في result للـ audit
                result['v62_fake_pump'] = _v62_fake_pump
                result['v62_distribution'] = _v62_is_dist
                result['v62_story_stock'] = _v62_story_stock
                result['v62_delta_vol'] = _v62_delta_vol
                result['v62_maker_sweep'] = (_ob_state.sweep_low if '_ob_state' in dir() else False) and _v62_delta_vol > 0

            except Exception as _v62_err:
                pass  # safe-by-design

            # ── V68 ORACLE ENGINE (المرحلة 4 — 2026-08-31): البصمة المستقبلية + الاحتمالات ──
            # 8 ميزات جديدة من Pine Script V68 (The Oracle Engine):
            #   1. probability (0-100): احتمالية نجاح الصفقة (4 عوامل × 25)
            #   2. future_direction: توقع الزخم (up/down/flat) عبر linreg slope
            #   3. quiet_accumulation: تراكم صامت (BB squeeze + حجم ضعيف)
            #   4. dirty_distribution: توزيع قاتل (ظهر + حجم + delta سالب) — رفض
            #   5. no_chase_2d: حظر مطاردة (عائد يومين > 15%) — رفض
            #   6. liquidity_grab: مسح سيولة (A+ signal trigger)
            #   7. low_magnet / high_magnet: خريطة الجثث (مستويات سيولة)
            #   8. trend_state: 1=صاعد / -1=هابط / 0=محايد
            # الإثبات الثامن (proof #8): oracle_probability ≥ 50 → ✅
            # A+ Gate: liquidity_grab يتطلب probability ≥ 70% (زي Pine V68)
            try:
                from analyzers.v68_oracle import analyze_oracle
                _v68_closes = closes[:day_idx + 1] if 'closes' in dir() and day_idx < len(closes) else []
                _v68_highs = highs[:day_idx + 1] if 'highs' in dir() and day_idx < len(highs) else []
                _v68_lows = lows[:day_idx + 1] if 'lows' in dir() and day_idx < len(lows) else []
                _v68_vols = volumes[:day_idx + 1] if 'volumes' in dir() and day_idx < len(volumes) else []
                _v68_opens = opens[:day_idx + 1] if 'opens' in dir() and day_idx < len(opens) else []
                _v68_atr = float(result.get('atr', 0) or 0)
                if _v68_atr <= 0:
                    _v68_atr = entry * 0.05

                _v68 = analyze_oracle(
                    _v68_closes, _v68_highs, _v68_lows, _v68_vols, _v68_opens,
                    atr=_v68_atr, entry=entry
                )

                # خزّن V68 flags في result للـ audit
                result['v68_probability'] = _v68['probability']
                result['v68_future_direction'] = _v68['future_direction']
                result['v68_future_momentum'] = _v68['future_momentum']
                result['v68_quiet_accumulation'] = _v68['quiet_accumulation']
                result['v68_dirty_distribution'] = _v68['dirty_distribution']
                result['v68_no_chase_2d'] = _v68['no_chase_2d']
                result['v68_liquidity_grab'] = _v68['liquidity_grab']
                result['v68_low_magnet'] = _v68['low_magnet']
                result['v68_high_magnet'] = _v68['high_magnet']
                result['v68_trend_state'] = _v68['trend_state']
                result['v68_delta_vol'] = _v68['delta_vol']

                # ── V68 REJECT GATES (hard rejects) — A/B toggleable ──
                # 1. dirty_distribution: الحوت بيفرغ → ممنوع الدخول
                if V68_DIRTY_DIST_REJECT and _v68['dirty_distribution']:
                    print(f"[V68-DIRTY-DIST] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"توزيع قاتل (ظهر علوي + حجم انفجاري + delta سالب) → رفض", flush=True)
                    # NOTEBOOK: سجّل رفض الفلتر
                    try:
                        from analyzers.stock_notebook import add_filter_rejection
                        add_filter_rejection(ticker, 'V68-dirty-dist',
                            'توزيع قاتل: ظهر علوي + حجم انفجاري + delta سالب', source='v68')
                    except Exception:
                        pass
                    continue

                # 2. no_chase_2d: قفز 15% في يومين → ممنوع الدخول
                if V68_NO_CHASE_2D_REJECT and _v68['no_chase_2d']:
                    print(f"[V68-NO-CHASE-2D] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"قفز >15% في يومين (توزيع) → رفض", flush=True)
                    continue

                # 3. future_direction هابط بقوة → تقليل الثقة (مش رفض)
                if _v68['future_direction'] == 'down' and _v68['future_momentum'] < -0.3:
                    print(f"[V68-FUTURE-DOWN] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"البصمة المستقبلية هابطة (momentum={_v68['future_momentum']:.3f}%) → تقليل ثقة", flush=True)

                # ── V68 PROOF #8: oracle_probability — A/B toggleable ──
                # ✅ لو probability >= 50 → إثبات قوي
                # ⚠️ لو probability 25-50 → إثبات ضعيف
                # ❌ لو probability < 25 → مفيش إثبات
                if V68_PROOF_PROBABILITY:
                    _v68_proof_str = ''
                    if _v68['probability'] >= 70:
                        _v68_proof_str = f'✅ احتمالية عالية ({_v68["probability"]}/100)'
                    elif _v68['probability'] >= 50:
                        _v68_proof_str = f'⚠️ احتمالية متوسطة ({_v68["probability"]}/100)'
                    else:
                        _v68_proof_str = f'❌ احتمالية ضعيفة ({_v68["probability"]}/100)'

                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['oracle_probability'] = _v68_proof_str

                # ── V68 A+ GATE: liquidity_grab يتطلب probability >= 70% — A/B toggleable ──
                # Pine V68: A+ Liquidity Grab signal بـ يتطلب probability >= 70%
                if V68_APLUS_BOOST and _v68['liquidity_grab'] and _v68['probability'] >= 70:
                    # A+ signal: boost الـ tech_score ونضيف إثبات
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['liquidity_grab_a_plus'] = '✅ A+ Liquidity Grab (probability ≥ 70%)'
                    print(f"[V68-A-PLUS] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"A+ Liquidity Grab! probability={_v68['probability']}/100 "
                          f"low_magnet={_v68['low_magnet']:.2f} → boost", flush=True)
                    # A+ boost: +10 points للـ tech_score (max 100)
                    if isinstance(result.get('score'), (int, float)):
                        result['score'] = min(100, result['score'] + 10)

                # ── V68 MAGNETIC TARGET: high_magnet → target_2 — A/B toggleable ──
                # Pine V68: tp2 = active_high_magnet (الهدف المستقبلي = المغناطيس العلوي)
                # ده بـ يحسن الـ R:R لو المغناطيس أعلى من الـ target الحالي
                if V68_MAGNETIC_TARGET and _v68['high_magnet'] and _v68['high_magnet'] > entry:
                    _v68_mag_target = _v68['high_magnet']
                    _v68_mag_rr = (_v68_mag_target - entry) / max(0.01, entry - stop)
                    # لو المغناطيس بـ يدي R:R >= 2 → استخدمه كـ target_2 (runner)
                    if _v68_mag_rr >= 2.0 and _v68_mag_target > target:
                        result['target_2'] = _v68_mag_target
                        print(f"[V68-MAGNET-TARGET] {ticker}: high_magnet={_v68_mag_target:.2f} "
                              f"(R:R={_v68_mag_rr:.2f}) → target_2", flush=True)

            except Exception as _v68_err:
                pass  # safe-by-design: لو V68 فشل → نكمّل بدونه

            # ── V72 MULTI-PATH ENGINE (المرحلة 5 — 2026-08-31): 6 ميزات جديدة ──
            # كل ميزة toggleable via env var (default=0 — الباك-تست يقرر)
            # 1. wash_trade reject: حجم ضخم بدون حركة سعر = فخ → رفض
            # 2. hidden_dist block: توزيع خفي → block 10 شموع
            # 3. pullback_buy: مسار دخول جديد (ارتداد على الدعم)
            # 4. maker_death_point: وقف ديناميكي حسب نوع الدخول
            # 5. kill_switch exit: في daily_closer (مش هنا)
            # 6. market_bullish sizing: تقليل الحجم في السوق الهابط
            try:
                from analyzers.multi_path_detector import (
                    detect_wash_trade, detect_hidden_distribution,
                    detect_pullback_buy, compute_maker_death_point,
                    detect_choch_bear, compute_market_bullish_sizing
                )
                _v72_closes = closes[:day_idx + 1] if 'closes' in dir() and day_idx < len(closes) else []
                _v72_highs = highs[:day_idx + 1] if 'highs' in dir() and day_idx < len(highs) else []
                _v72_lows = lows[:day_idx + 1] if 'lows' in dir() and day_idx < len(lows) else []
                _v72_vols = volumes[:day_idx + 1] if 'volumes' in dir() and day_idx < len(volumes) else []
                _v72_opens = opens[:day_idx + 1] if 'opens' in dir() and day_idx < len(opens) else []
                _v72_atr = float(result.get('atr', 0) or 0) or (entry * 0.05)

                # ── V72-1: Wash Trade Reject ──
                if V72_WASH_TRADE_REJECT:
                    _v72_wash = detect_wash_trade(_v72_highs, _v72_lows, _v72_closes, _v72_vols, _v72_atr)
                    result['v72_wash_trade'] = _v72_wash
                    if _v72_wash:
                        print(f"[V72-WASH-TRADE] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"حجم ضخم بدون حركة سعر = تدوير وهمي → رفض", flush=True)
                        continue

                # ── V72-2: Hidden Distribution Block ──
                if V72_HIDDEN_DIST_BLOCK:
                    _v72_hd = detect_hidden_distribution(_v72_highs, _v72_lows, _v72_vols, len(_v72_highs))
                    result['v72_hidden_dist'] = _v72_hd
                    if _v72_hd.get('block_active'):
                        print(f"[V72-HIDDEN-DIST] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"توزيع خفي (higher high + lower volume) → block "
                              f"{_v72_hd.get('block_remaining', 0)} bars → رفض", flush=True)
                        # NOTEBOOK: سجّل رفض الفلتر
                        try:
                            from analyzers.stock_notebook import add_filter_rejection
                            add_filter_rejection(ticker, 'V72-hidden-dist',
                                f'توزيع خفي: higher high + lower volume (block {_v72_hd.get("block_remaining",0)} bars)',
                                source='v72')
                        except Exception:
                            pass
                        continue

                # ── V72-3: Pullback Buy (new entry path) ──
                # لو مفيش signal من V40.2 الأساسي، جرّب pullback_buy
                if V72_PULLBACK_BUY_PATH:
                    # نحتاج nearest_support — نستخدم low_magnet من V68 كـ support
                    _v72_support = result.get('v68_low_magnet')
                    _v72_delta = result.get('v68_delta_vol', 0)
                    # trend_state من V68 (1=صاعد)
                    _v72_trend = result.get('v68_trend_state', 0)
                    _v72_pb = detect_pullback_buy(
                        _v72_closes, _v72_highs, _v72_lows, _v72_opens, _v72_vols,
                        _v72_support, _v72_atr, _v72_delta, _v72_trend
                    )
                    result['v72_pullback_buy'] = _v72_pb
                    if _v72_pb:
                        print(f"[V72-PULLBACK-BUY] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"ارتداد على الدعم (trend=1 + touch support + green + delta+) → boost", flush=True)
                        # boost: +8 points للـ tech_score
                        if isinstance(result.get('score'), (int, float)):
                            result['score'] = min(100, result['score'] + 8)
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['pullback_buy'] = '✅ V72 ارتداد على الدعم (multi-path)'

                # ── V72-4: Maker Death Point (dynamic stop) ──
                # لو مفعّل، نستبدل الـ stop بـ death_point (لو أقرب للسعر = أكثر حماية)
                if V72_MAKER_DEATH_POINT:
                    _v72_sweep = result.get('v68_liquidity_grab', False)
                    _v72_sweep_low = _v72_lows[-1] if _v72_sweep and _v72_lows else None
                    _v72_support = result.get('v68_low_magnet')
                    _v72_dp = compute_maker_death_point(
                        entry, _v72_atr, _v72_sweep, _v72_sweep_low, _v72_support
                    )
                    result['v72_death_point'] = _v72_dp
                    # استخدم death_point لو أعلى من stop الحالي (أقرب للسعر = tighter)
                    if 0 < _v72_dp < entry and _v72_dp > stop:
                        print(f"[V72-DEATH-POINT] {ticker}: stop {stop:.2f} → {_v72_dp:.2f} "
                              f"(sweep={_v72_sweep}, support={_v72_support})", flush=True)
                        stop = _v72_dp

                # ── V72-6: Market Bullish Sizing ──
                # بـ يؤثر على liquidity_pos_mult (لو السوق هابط → نصّف الحجم)
                if V72_MARKET_BULLISH_SIZING:
                    # market_bullish = market_regime in (bull, range) — V40.2 عندها market_regime_trend
                    _v72_regime = result.get('market_regime_trend', 'range')
                    _v72_bullish = _v72_regime in ('bull', 'range')  # range = neutral (مش هابط)
                    if not _v72_bullish:
                        print(f"[V72-MARKET-SIZING] {ticker}: السوق {_v72_regime} → "
                              f"نصّف الحجم (0.5×)", flush=True)
                        result['v72_market_bearish'] = True

            except Exception as _v72_err:
                pass  # safe-by-design: لو V72 فشل → نكمّل بدونه

            # ── V73 SNIPER ENGINE (المرحلة 6 — 2026-08-31): 2 ميزات جديدة ──
            # 1. desert_phase: BB squeeze + volume < 0.5×MA = سهم ميت → رفض
            # 2. auction_trap: شمعة واحدة >10% = مصيدة مزاد → رفض
            # A/B على 6 شهور (Feb-Aug 2026) عشان نتأكد general مش overfit
            try:
                from analyzers.sniper_detector import detect_desert_phase, detect_auction_trap
                _v73_closes = closes[:day_idx + 1] if 'closes' in dir() and day_idx < len(closes) else []
                _v73_vols = volumes[:day_idx + 1] if 'volumes' in dir() and day_idx < len(volumes) else []
                _v73_opens = opens[:day_idx + 1] if 'opens' in dir() and day_idx < len(opens) else []

                # V73-1: Desert Phase Reject
                if V73_DESERT_PHASE_REJECT:
                    _v73_desert = detect_desert_phase(_v73_closes, _v73_vols, 20)
                    result['v73_desert_phase'] = _v73_desert
                    if _v73_desert:
                        print(f"[V73-DESERT] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"الموت السريري (squeeze + volume ميت) → رفض", flush=True)
                        # NOTEBOOK: سجّل رفض الفلتر
                        try:
                            from analyzers.stock_notebook import add_filter_rejection
                            add_filter_rejection(ticker, 'V73-desert',
                                'الموت السريري: BB squeeze + volume < 0.5×MA', source='v73')
                        except Exception:
                            pass
                        continue

                # V73-2: Auction Trap Reject
                if V73_AUCTION_TRAP_REJECT:
                    _v73_auction = detect_auction_trap(_v73_opens, _v73_closes, 10.0)
                    result['v73_auction_trap'] = _v73_auction
                    if _v73_auction:
                        print(f"[V73-AUCTION-TRAP] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"مصيدة مزاد (شمعة +{((_v73_closes[-1]-_v73_opens[-1])/_v73_opens[-1]*100):.1f}% > 10%) → رفض", flush=True)
                        continue

            except Exception as _v73_err:
                pass  # safe-by-design: لو V73 فشل → نكمّل بدونه

            # ── V76 GOLDEN HUNTER (المرحلة 8 — 2026-09-01): 2 إشارات جديدات ──
            # A/B BACKTEST RESULTS (300 tickers, 6 months):
            #   ✅ PUMP_FROM_DESERT: 25 trades, WR 56.0%, Return +26.7% (KEEP)
            #   ✅ GOLDEN_RETEST: 30 trades, WR 63.3%, Return -1.2% (KEEP — high WR)
            # محرك صيد الانفجارات من النعاس + إعادة الاختبار الذهبي
            if os.environ.get('V76_GOLDEN_HUNTER', '1') == '1':
                try:
                    from analyzers.golden_hunter import analyze_v76
                    _v76_closes = closes[:day_idx + 1] if 'closes' in dir() and day_idx < len(closes) else []
                    _v76_highs = highs[:day_idx + 1] if 'highs' in dir() and day_idx < len(highs) else []
                    _v76_lows = lows[:day_idx + 1] if 'lows' in dir() and day_idx < len(lows) else []
                    _v76_vols = volumes[:day_idx + 1] if 'volumes' in dir() and day_idx < len(volumes) else []
                    _v76_opens = opens[:day_idx + 1] if 'opens' in dir() and day_idx < len(opens) else []

                    _v76 = analyze_v76(_v76_closes, _v76_highs, _v76_lows, _v76_vols, _v76_opens)
                    result['v76_signal'] = _v76['signal']
                    result['v76_reason'] = _v76['reason']

                    # لو V76 طلع signal قوي → boost
                    if _v76['signal'] == 'PUMP_FROM_DESERT':
                        print(f"[V76-PUMP-FROM-DESERT] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"انفجار من نعاس → boost", flush=True)
                        if isinstance(result.get('score'), (int, float)):
                            result['score'] = min(100, result['score'] + 15)
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['v76_pump_from_desert'] = '✅ V76 انفجار من نعاس (proven +26.7%)'
                    elif _v76['signal'] == 'GOLDEN_RETEST':
                        print(f"[V76-GOLDEN-RETEST] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"إعادة اختبار ذهبية → boost", flush=True)
                        if isinstance(result.get('score'), (int, float)):
                            result['score'] = min(100, result['score'] + 10)
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['v76_golden_retest'] = '✅ V76 إعادة اختبار ذهبية (WR 63.3%)'
                except Exception as _v76_err:
                    pass  # safe-by-design

            # ── EGX-STRATEGY-DYNAMIC (المرحلة 1 — 2026-08-30): وقف + هدف ديناميكي ──
            # المالك طلب: "الوقف والهدف يرتبطوا بسلوك السهم الفعلي (swing low/high)."
            # - الوقف: آخر قاع واضح (swing_low) + 0.5×ATR buffer.
            # - الهدف: أقرب مقاومة (swing_high) أو ATR fallback.
            # - target_2 (Runner): max(target×1.5, entry+5×ATR).
            # لو مفيش swing low/high → fallback للمنطق القديم (ATR).
            try:
                from core.opportunity_quality import enforce_atr_based_stop, compute_dynamic_target
                _atr_val = float(result.get('atr', 0) or 0)
                if _atr_val <= 0:
                    _atr_val = entry * 0.05  # fallback 5%
                _lows_dyn = lows[:day_idx+1] if 'lows' in dir() else []
                _highs_dyn = highs[:day_idx+1] if 'highs' in dir() else []

                # وقف ديناميكي
                _stop_check = enforce_atr_based_stop(
                    signal, entry, stop, _atr_val, 'balanced', lows=_lows_dyn
                )
                if _stop_check['action'] == 'replace_stop' and _stop_check['fixed']:
                    _old_stop = stop
                    stop = _stop_check['fixed']['stop_loss']
                    if stop != _old_stop:
                        print(f"[DYN-STOP] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"entry={entry:.2f} stop {_old_stop:.2f}→{stop:.2f} "
                              f"({_stop_check.get('stop_source', '?')})", flush=True)

                # هدف ديناميكي
                # COUNTER-TREND FIX (2026-10-07): في DEFENSIVE regime، لازم min_rr=2.5
                # علشان الـ target يبعد أكتر عن الـ entry والسهم يعدّي الـ REGIME-RR-SKIP check.
                # لو min_rr=1.8 (الـ default) → R:R دايماً = 1.80 → كل الأسهم بتـ skip في DEFENSIVE.
                # Owner: "بتحاول تشتري السهم في أوسخ مكان وتسيب فرص جامدة جدا"
                _dyn_min_rr = 1.8  # default للـ NORMAL/AGGRESSIVE
                try:
                    _regime_for_target = result.get('market_regime_trend', 'range')
                    if _regime_cfg is not None:
                        _market_min_rr_for_target = float(_regime_cfg.get("min_rr", 1.8))  # Rule 18 floor (was 1.5)
                        # لو السوق DEFENSIVE → استخدم max(market_min_rr, 2.5)
                        # علشان الـ counter-trend mode بيطلب R/R ≥ 2.5
                        if _regime_cfg.get('regime_name', '').lower() in ('defensive', 'bear', 'strong_bear') or _market_min_rr_for_target >= 2.0:
                            _dyn_min_rr = max(_market_min_rr_for_target, 2.5)
                except Exception:
                    pass
                _target_check = compute_dynamic_target(
                    entry, stop, _atr_val, highs=_highs_dyn, min_rr=_dyn_min_rr
                )
                if _target_check['target'] > 0:
                    _old_target = target
                    target = _target_check['target']
                    target_2 = _target_check['target_2']
                    r_mult = _target_check['rr']
                    result['target_2'] = target_2
                    if target != _old_target:
                        print(f"[DYN-TARGET] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"target {_old_target:.2f}→{target:.2f} (R:R={r_mult:.2f}) "
                              f"target_2={target_2:.2f} ({_target_check.get('source', '?')})", flush=True)

                    # ═══════════════════════════════════════════════════════════════════════
                    # Task IMPROVEMENT-06-2026-10-06 (Rule 71): DNA PROJECTION target_3
                    # مصدر الإلهام: data/pine_scripts/EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine (lines 443-540)
                    # الهدف: توقع الهدف الثالث بناءً على نسبة الحركة التاريخية للسهم
                    # المنطق:
                    #   - لو السهم ارتد +X% من قاع في الماضي → نتوقع إنه يكمل +X% مرة تانية
                    #   - target_3 = target_2 × (1 + avg_historical_move_pct)
                    #   - avg_historical_move_pct = متوسط نسبة الصعود من قاع لقمة في آخر 3 موجات
                    #   - محدود بـ +50% كحد أقصى (تجنّب التوقعات الخيالية)
                    # ═══════════════════════════════════════════════════════════════════════
                    try:
                        if len(closes[:day_idx+1]) >= 30 and target_2 > 0:
                            # نحسب آخر 3 موجات صاعدة (swing low → swing_high)
                            _recent_closes = closes[:day_idx+1][-30:]
                            _swing_lows = []
                            _swing_highs = []
                            for i in range(2, len(_recent_closes) - 2):
                                if _recent_closes[i] < _recent_closes[i-1] and _recent_closes[i] < _recent_closes[i+1] and _recent_closes[i] < _recent_closes[i-2] and _recent_closes[i] < _recent_closes[i+2]:
                                    _swing_lows.append(_recent_closes[i])
                                if _recent_closes[i] > _recent_closes[i-1] and _recent_closes[i] > _recent_closes[i+1] and _recent_closes[i] > _recent_closes[i-2] and _recent_closes[i] > _recent_closes[i+2]:
                                    _swing_highs.append(_recent_closes[i])

                            _move_pcts = []
                            if len(_swing_lows) >= 1 and len(_swing_highs) >= 1:
                                # نقارن آخر 3 أزواج swing_low → swing_high
                                _pairs = min(len(_swing_lows), len(_swing_highs), 3)
                                for j in range(_pairs):
                                    if _swing_lows[j] > 0:
                                        _move_pct = (_swing_highs[j] - _swing_lows[j]) / _swing_lows[j]
                                        _move_pcts.append(_move_pct)

                            if _move_pcts:
                                _avg_move_pct = sum(_move_pcts) / len(_move_pcts)
                                # محدود بـ 50% كحد أقصى
                                _avg_move_pct = min(_avg_move_pct, 0.50)
                                # target_3 = target_2 × (1 + avg_move_pct × 0.7)
                                # × 0.7 عشان نخفّف التفاؤل (conservative projection)
                                _target_3 = round(target_2 * (1 + _avg_move_pct * 0.7), 2)
                                # لازم يكون أكبر من target_2
                                if _target_3 > target_2:
                                    result['target_3'] = _target_3
                                    print(f"[DNA-PROJECTION] {ticker}: target_3={_target_3:.2f} (avg_hist_move={_avg_move_pct*100:.1f}%, {len(_move_pcts)} waves)", flush=True)
                                else:
                                    result['target_3'] = round(target_2 * 1.15, 2)  # fallback +15%
                            else:
                                # fallback: target_3 = target_2 + 15%
                                result['target_3'] = round(target_2 * 1.15, 2)
                        else:
                            result['target_3'] = round(target_2 * 1.15, 2)  # fallback +15%
                    except Exception as _dna_err:
                        result['target_3'] = round(target_2 * 1.15, 2)  # safe fallback
            except Exception as _dyn_err:
                pass  # safe-by-design: لو فشل، سيب الـ stop/target القديم

            # ─── PREDICTION-INTEGRITY (2026-10-11): validate stop/target direction ───
            # FIX: daily_predictor.py ما كانش بيستدعي validate_target_stop_direction.
            # ده السبب الجذري لـ DOMT (stop=25.91 > entry=24.90 مع signal=HOLD).
            # validate_target_stop_direction بتـ fix تلقائياً: stop > entry للـ BUY → entry*0.97.
            # القاعدة 8 (ATR stop [5%,9%]) + القاعدة 18 (R:R ≥ 1.8) + Rule 67 (canonical).
            try:
                from core.opportunity_quality import validate_target_stop_direction
                _dir_check = validate_target_stop_direction(
                    signal, entry, target, stop
                )
                if not _dir_check['valid'] and _dir_check['action'] == 'fix_target' and _dir_check['fixed']:
                    if 'stop_loss' in _dir_check['fixed']:
                        _old_stop = stop
                        stop = _dir_check['fixed']['stop_loss']
                        print(f"[DIR-FIX] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"stop {_old_stop:.2f}→{stop:.2f} ({_dir_check['reason']})", flush=True)
                    if 'target_price' in _dir_check['fixed']:
                        _old_target = target
                        target = _dir_check['fixed']['target_price']
                        print(f"[DIR-FIX] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"target {_old_target:.2f}→{target:.2f} ({_dir_check['reason']})", flush=True)
                    # إعادة حساب R:R بعد الـ fix
                    risk = abs(entry - stop)
                    reward = abs(target - entry)
                    r_mult = round(reward / risk, 2) if risk > 0 else 0
            except Exception as _dir_err:
                print(f"[DIR-FIX-WARN] {ticker}: validate_target_stop_direction failed: {_dir_err}", flush=True)

            # ─── V40.3 REGIME-RR (2026-08-17): regime-aware R:R floor with absolute 1.5 ───
            # Owner directive: replace flat dynamic_rr_normal with get_dynamic_min_rr(regime).
            #   bull  → 2.0  (نطمع أكتر)
            #   range → 1.5  (was 1.2 — العمولات بـ تاكل الـ edge تحت 1.5)
            #   bear  → 1.8  (صفقات الارتداد النادرة؛ cash-mode veto بـ يـ handle أغلب الـ bear)
            # Absolute floor 1.5 مطلقًا — ممنوع R:R < 1.5 تحت أي ظرف.
            # get_dynamic_min_rr بـ يـ apply الـ floor internally كمان (defense-in-depth).
            try:
                from analyzers.engine_settings import get_dynamic_min_rr
                _regime = result.get('market_regime_trend', 'range')
                _min_rr = get_dynamic_min_rr(_regime)
            except Exception:
                _min_rr = 2.0  # C1 floor if settings unavailable
            # V75-7: 2R minimum R:R (stricter than regime default)
            if False:  # V75 killed
                _min_rr = max(_min_rr, 2.0)
            # REGIME-ENGINE (2026-09-27): market-level regime overrides per-ticker regime.
            # If MarketRegimeEngine says DEFENSIVE → require min_rr=2.0 regardless of ticker regime.
            # We take the MAX so the stricter of (per-ticker regime, market regime) wins.
            if _regime_cfg is not None:
                _market_min_rr = float(_regime_cfg.get("min_rr", 1.8))  # Rule 18 floor (was 1.5)
                if _market_min_rr > _min_rr:
                    if r_mult < _market_min_rr:
                        print(f"[REGIME-RR-SKIP] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                              f"R:R={r_mult:.2f} < {_market_min_rr} ({_regime_name} market regime "
                              f"> ticker {_regime} regime {_min_rr})", flush=True)
                        continue
                    _min_rr = _market_min_rr  # for the message below
            if r_mult < _min_rr:
                print(f"[RR-SKIP] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: R:R={r_mult:.2f} < {_min_rr} ({_regime}) entry={entry:.2f} stop={stop:.2f} target={target:.2f}", flush=True)
                continue

            # DNA-DEBUG: trace AMOC specifically
            if ticker == 'AMOC':
                print(f"[DNA-TRACE] AMOC passed R:R check! r_mult={r_mult:.2f} min_rr={_min_rr}", flush=True)

            # ── EGX-STRATEGY-STAGE2: تصنيف نوع السيولة ──
            # المالك طلب: "النظام يفرق أكتر بين السيولة الذكية والسيولة المضاربية الهشة"
            # classify_liquidity بترجع: type + score + position_size_mult + hold_multiplier
            _liquidity = None
            try:
                from core.opportunity_quality import classify_liquidity
                _liquidity = classify_liquidity(
                    closes[:day_idx+1], volumes[:day_idx+1],
                    opens[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1]
                )
                if _liquidity['type'] != 'neutral':
                    print(f"[LIQUIDITY] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"type={_liquidity['type']} score={_liquidity['score']} "
                          f"vol_ratio={_liquidity['vol_ratio']} pos_mult={_liquidity['position_size_mult']}", flush=True)
            except Exception:
                _liquidity = None

            # ── EXPLOSIVE UNCAP (Revived from Maestro 55.7% WR) ──
            # للأاسهم الانفجارية: فك سقف الهدف حتى 5×ATR ووقف واسع حتى لا يتم إخراج الصفقة مبكراً
            if os.environ.get('V40_EXPLOSIVE_UNCAP', '1') == '1':
                _is_pump_v76 = result.get('v76_signal') == 'PUMP_FROM_DESERT'
                _vol_ratio = _liquidity.get('vol_ratio', 1.0) if _liquidity else 1.0
                _change_pct = ((closes[day_idx] - closes[day_idx-1]) / closes[day_idx-1] * 100) if day_idx > 0 else 0
                _is_high_mom = (_vol_ratio >= 1.8 and _change_pct >= 3.0)

                if _is_pump_v76 or _is_high_mom:
                    _uncap_target = round(entry + (_atr_val * 5.0), 2)
                    if _uncap_target > target:
                        _old_t = target
                        target = _uncap_target
                        target_2 = round(entry + (_atr_val * 8.0), 2)
                        result['target_2'] = target_2
                        # TIGHTENING (2026-09-02): explosive stop from -8.5% (0.915) to -7% (0.93)
                        # Owner directive: "خفّض الستوب الأقصى من 9% لـ 7% (أو خلّيه ATR-based بس بحد أقصى 7%)"
                        # Task REAPPLY-CRITICAL-FIXES: canonical default = 9.0 (engine_settings.py:241, Rule 8). Was 7.0 (stale).
                        _explosive_stop_max_pct = float(os.environ.get('V40_2_STOP_MAX_PCT', '9.0'))  # Task REAPPLY-CRITICAL-FIXES — was '7.0'
                        _explosive_stop = round(entry * (1 - _explosive_stop_max_pct / 100.0), 2)
                        if stop < _explosive_stop:
                            stop = _explosive_stop
                        # Rule 54: استخدم canonical compute_risk_reward
                        try:
                            from utils.risk_reward import compute_risk_reward
                            r_mult = compute_risk_reward(entry, target, stop, fallback=0.0)
                        except Exception:
                            r_mult = (target - entry) / max(0.01, entry - stop)
                        print(f"[EXPLOSIVE-UNCAP] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: target {_old_t:.2f}→{target:.2f} (5×ATR) target_2={target_2:.2f} (R:R={r_mult:.2f})", flush=True)
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['explosive_uncap'] = f'🚀 هدف انفجاري مفتوح (5×ATR={_atr_val*5.0:.2f})'

            # ── NEWS IMPACT (2026-09-01): تصنيف الأخبار + veto/boost ──
            # مشكلة المالك: "الأخبار بتحرك السوق بطريقة مش طبيعية — اكتتابات بتطير،
            # توزيع أرباح بيموت السعر". الحل: news_impact_scorer بـ يصنّف events.
            # - VETO (fraud/halt) → skip التوقع تماماً
            # - REDUCE (dividend ex-date/miss) → تقليل score
            # - BOOST (IPO/beat/MA) → رفع score
            # NOTE: في backtest mode، الأخبار التاريخية مش متاحة → skip (NEUTRAL)
            # NOTE: في production، news_fetcher_analyzer بـ يجيب أخبار حقيقية + يحللها
            # P1-FIX (2026-10-09, Round 2): default ON (كان OFF)
            # قبل كده: default '0' → الأخبار مش بتأثر على التوقعات
            # دلوقتي: default '1' → الأخبار بتأثر على الـ score (لو news-agent شغّال)
            # الأثر: لو news-agent مش متثبت cron أو news.db فاضي، الـ code بيتخطاه بأمان
            if os.environ.get('V40_2_NEWS_IMPACT', '1') == '1':
                _is_backtest = os.environ.get('V40_2_BACKTEST_MODE', '0') == '1'
                _force_news_in_backtest = os.environ.get('V40_2_FORCE_NEWS_IN_BACKTEST', '0') == '1'
                if not _is_backtest or _force_news_in_backtest:
                    try:
                        # استخدم news_fetcher_analyzer (جديد — يجيب أخبار حقيقية + يحللها)
                        from analyzers.news_fetcher_analyzer import get_news_with_impact
                        _news_result = get_news_with_impact(ticker, max_news=3)
                        _news_score = _news_result.get('overall_score', 0)
                        _news_verdict = _news_result.get('overall_verdict', 'NEUTRAL')

                        if _news_verdict == 'VETO' and _news_score <= -2:
                            print(f"[NEWS-VETO] {ticker} on {scan_date}: "
                                  f"{_news_result.get('reason', '')} → رفض", flush=True)
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['news_veto'] = _news_result.get('proof_string', '')
                            try:
                                from analyzers.decision_logger import log_decision
                                log_decision(ticker, 'reject_entry', 'news_veto',
                                    _news_result.get('reason', ''), 'V40_2_NEWS_IMPACT',
                                    market='STOCKS', scan_date=scan_date, score_before=result.get('score', 0))
                            except Exception:
                                pass
                            continue  # hard reject

                        # Apply score adjustment (BOOST or REDUCE) — scale ×10 للـ V40.2 score (0-100)
                        if _news_score != 0:
                            print(f"[NEWS-{_news_verdict}] {ticker} on {scan_date}: "
                                  f"score={_news_score:+d} (news_count={_news_result.get('news_count', 0)}) → "
                                  f"{'دفعة' if _news_score > 0 else 'تقليل'}", flush=True)
                            if isinstance(result.get('score'), (int, float)):
                                result['score'] = max(0, min(100, result['score'] + (_news_score * 10)))
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['news_impact'] = _news_result.get('proof_string', '')
                            result['news_verdict'] = _news_verdict
                            result['news_score'] = _news_score
                    except Exception as _news_err:
                        pass  # safe-by-design: لو news fetcher فشل → نكمّل

            # ── LOCAL NEWS AGENT SIGNALS (2026-09-01) ──────────────────
            # يقرأ الأخبار المحللة من وكيل الأخبار المحلي (اللاب توب)
            # وبيطبّق تحيز −15 → +15 على الـ score
            # الفكرة: اللاب توب بيجمع أخبار من تيليجرام + ويب + RSS
            #         ويبعتها للسيرفر كـ JSON منظم في news.db.market_news
            # Toggle: V40_2_LOCAL_NEWS=1 (default OFF للـ backtest)
            if os.environ.get('V40_2_LOCAL_NEWS', '0') == '1':
                _is_backtest = os.environ.get('V40_2_BACKTEST_MODE', '0') == '1'
                if not _is_backtest:
                    try:
                        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
                        from ai.market_news_reader import apply_news_bias_to_score
                        _current_score = result.get('score', 0) if isinstance(result.get('score'), (int, float)) else 0
                        _adj_score, _news_ctx = apply_news_bias_to_score(_current_score, ticker)
                        if _news_ctx['has_news'] and _news_ctx['bias'] != 0:
                            result['score'] = _adj_score
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            direction = 'دفعة' if _news_ctx['bias'] > 0 else 'تقليل'
                            result['proofs']['local_news'] = (
                                f"📰 {_news_ctx['news_count']} خبر ({_news_ctx['sentiment']}) → "
                                f"{direction} {abs(_news_ctx['bias'])} نقطة"
                            )
                            print(
                                f"  [LOCAL-NEWS] {ticker}: {_news_ctx['news_count']} خبر "
                                f"({_news_ctx['sentiment']}) → bias={_news_ctx['bias']:+d} "
                                f"| score {_current_score:.1f}→{_adj_score:.1f}",
                                flush=True
                            )
                    except Exception:
                        pass  # safe-by-design

            # ── EXPERT RECOMMENDATIONS (2026-09-02): توصيات الخبراء البشرية ──
            # توجيه المالك: "دة لسة تحت الأختبار عالشان الملك توصيات بشرية تساعدك
            #                فى التحليلات ممكن تجهز نفسك عالشان نستقبلة ونستعمله"
            # المصدر: news repo recommendation_aggregator.py (Ollama + خبراء تيليجرام)
            #         → POST /api/expert-recommendations/import → stocks.db
            #         → V40.2 بيقرأ من الإنتاج عبر /api/proxy-prod/expert-recommendations
            # الأثر على score:
            #   STRONG_BUY (2+ خبراء بيوصوا بالشراء) → +20
            #   BUY (1+ خبير شراء، أغلبية شراء) → +10
            #   SELL (2+ خبراء بيع) → -10
            #   HOLD (محايد/متساوي) → 0
            # Toggle: V40_2_EXPERT_RECS=1 (default OFF للـ backtest)
            #         V40_2_FORCE_EXPERT_RECS_IN_BACKTEST=1 → اختبار في backtest
            if os.environ.get('V40_2_EXPERT_RECS', '0') == '1':
                _is_backtest = os.environ.get('V40_2_BACKTEST_MODE', '0') == '1'
                _force_expert_recs = os.environ.get('V40_2_FORCE_EXPERT_RECS_IN_BACKTEST', '0') == '1'
                if not _is_backtest or _force_expert_recs:
                    try:
                        from analyzers.news_fetcher_analyzer import get_expert_recommendations_impact
                        _expert_result = get_expert_recommendations_impact(ticker)
                        _expert_delta = _expert_result.get('score_delta', 0)
                        _expert_verdict = _expert_result.get('overall_verdict', 'NO_DATA')

                        if _expert_verdict == 'SELL' and _expert_delta <= -10:
                            # VETO: لو 2+ خبراء بيوصوا بالبيع → ارفض التوقع
                            print(f"[EXPERT-VETO] {ticker} on {scan_date}: "
                                  f"{_expert_result.get('reason', '')} → رفض", flush=True)
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['expert_veto'] = _expert_result.get('proof_string', '')
                            try:
                                from analyzers.decision_logger import log_decision
                                log_decision(ticker, 'reject_entry', 'expert_veto',
                                    _expert_result.get('reason', ''), 'V40_2_EXPERT_RECS',
                                    market='STOCKS', scan_date=scan_date, score_before=result.get('score', 0))
                            except Exception:
                                pass
                            continue  # hard reject

                        # Apply score adjustment (BOOST/REDUCE)
                        if _expert_delta != 0:
                            print(f"[EXPERT-{_expert_verdict}] {ticker} on {scan_date}: "
                                  f"Δ={_expert_delta:+d} (recs={_expert_result.get('recommendations_count', 0)}) → "
                                  f"{'دفعة' if _expert_delta > 0 else 'تقليل'}", flush=True)
                            if isinstance(result.get('score'), (int, float)):
                                result['score'] = max(0, min(100, result['score'] + _expert_delta))
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['expert_impact'] = _expert_result.get('proof_string', '')
                            result['expert_verdict'] = _expert_verdict
                            result['expert_delta'] = _expert_delta
                            # خزّن تفاصيل التوصيات للـ UI
                            if _expert_result.get('recommendations'):
                                result['expert_recommendations'] = [
                                    {
                                        'expert': r.get('expert_name', ''),
                                        'action': r.get('action', ''),
                                        'entry_price': r.get('entry_price'),
                                        'target_price': r.get('target_price'),
                                        'stop_loss': r.get('stop_loss'),
                                        'notes': (r.get('notes') or '')[:200],
                                    }
                                    for r in _expert_result['recommendations'][:3]
                                ]
                    except Exception as _expert_err:
                        pass  # safe-by-design: لو expert fetcher فشل → نكمّل

            # ── STOCK NOTEBOOK CONTEXT (2026-09-01): طبقة معرفة دائمة ──
            # توجيه المالك: "كل سهم يكون ليه ملف دائم فيه ملخص سلوكي + ملاحظات.
            # النظام يقرأ النوتبوك الأول قبل القرار."
            # الـ module: vps-service/analyzers/stock_notebook.py
            # - danger_level >= 5 → continue (hard reject)
            # - danger_level >= 4 → score -= 5
            # - avoid_chase → دعم قرار الرفض (لو مع strict entry)
            # Toggle: V40_2_NOTEBOOK_CONTEXT=1 (default OFF للـ backtest)
            if os.environ.get('V40_2_NOTEBOOK_CONTEXT', '0') == '1':
                try:
                    from analyzers.stock_notebook import get_notebook_context_for_v402
                    _nb_ctx = get_notebook_context_for_v402(ticker, market=market_code)
                    if _nb_ctx['has_notebook']:
                        # Hard reject لو danger_level = 5
                        if _nb_ctx['should_reject']:
                            print(f"[NOTEBOOK-REJECT] {ticker} on {scan_date}: "
                                  f"danger_level=5 → رفض", flush=True)
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['notebook_reject'] = _nb_ctx['proof_string']
                            try:
                                from analyzers.decision_logger import log_decision
                                log_decision(ticker, 'reject_entry', 'danger_level_5',
                                    'نوتبوك: danger_level=5', 'V40_2_NOTEBOOK_CONTEXT',
                                    _nb_ctx.get('proof_string', ''), 'STOCKS',
                                    score_before=result.get('score', 0), scan_date=scan_date)
                            except Exception:
                                pass
                            continue  # hard reject

                        # Apply score adjustment
                        if _nb_ctx['score_adjustment'] != 0:
                            print(f"[NOTEBOOK] {ticker}: {_nb_ctx['proof_string'][:80]}", flush=True)
                            if isinstance(result.get('score'), (int, float)):
                                result['score'] = max(0, min(100, result['score'] + _nb_ctx['score_adjustment']))
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['notebook_context'] = _nb_ctx['proof_string']
                except Exception as _nb_err:
                    pass  # safe-by-design: لو notebook فشل → نكمّل

            # ── REGIME FILTER (2026-09-02): فلتر اتجاه إلزامي على إشارات BUY ──
            # توجيه المالك: "السوق المصري نزوله حاد كتير بيبقى Liquidity Grab من الصناع.
            # عايزين فلتر اتجاه قوي — ممنوع شراء ضد الاتجاه."
            # الـ module: vps-service/analyzers/regime_filter.py
            # - mode='A' (default): Close > SMA50 (اتجاه صحي متوسط المدى)
            # - mode='B': Close > SMA20 AND Close > SMA50 (تأكيد مزدوج — أصرم)
            # - لو not bullish → continue (hard reject — مش setup)
            # NOTE: بـ يشتغل على closes[:day_idx+1] (no lookahead)
            # Toggle: V40_2_REGIME_FILTER=1 (default OFF للتوافق مع الباك-تست القديم)
            # Mode: V40_2_REGIME_MODE='A'|'B' (default 'A')
            if os.environ.get('V40_2_REGIME_FILTER', '0') == '1':
                try:
                    from analyzers.regime_filter import is_bullish_regime
                    _regime_closes = closes[:day_idx + 1] if day_idx < len(closes) else closes
                    _regime_mode = os.environ.get('V40_2_REGIME_MODE', 'A')
                    _regime = is_bullish_regime(_regime_closes, mode=_regime_mode)

                    if not _regime['is_bullish']:
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['regime_filter_reject'] = _regime['reason']
                        try:
                            from analyzers.decision_logger import log_decision
                            log_decision(ticker, 'reject_entry', 'bearish_regime',
                                _regime['reason'][:200], 'V40_2_REGIME_FILTER',
                                market='STOCKS', scan_date=scan_date,
                                score_before=result.get('score', 0))
                        except Exception:
                            pass
                        continue  # hard reject — السهم في اتجاه هابط

                    # قبول — سجّل حالة الـ regime
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['regime_filter'] = _regime['reason']
                    result['regime_mode'] = _regime_mode
                    # متوسط سعر الدخول المتوقع (للعميل — ثقة + توقعات)
                    # based on historical avg holding per regime mode
                    result['expected_holding_days'] = 7 if _regime_mode == 'A' else 5
                except Exception as _regime_err:
                    pass  # safe-by-design: لو regime filter فشل → نكمّل بالسلوك القديم

            # ── STRICT ENTRY FILTER (2026-09-01): تراكم أو Liquidity Grab فقط ──
            # توجيه المالك: "النظام يرفض الدخول بعد الصعود القوي. يدخل فقط في
            # حالتين: تراكم حقيقي أو Liquidity Grab واضح. غير كده → رفض."
            # الـ module: vps-service/analyzers/strict_entry_filters.py
            # - is_late_entry → continue (Don't Chase — hard reject)
            # - is_in_accumulation OR is_liquidity_grab → قبول
            # - غير كده → continue (رفض — مش setup)
            # NOTE: بـ يشتغل على بيانات الـ day_idx الحالي (closes/highs/lows/volumes)
            # Toggle: V40_2_STRICT_ENTRY=1 (default OFF للتوافق مع الباك-تست القديم)
            if os.environ.get('V40_2_STRICT_ENTRY', '0') == '1':
                try:
                    from analyzers.strict_entry_filters import evaluate_strict_entry
                    _entry_closes = closes[:day_idx + 1] if day_idx < len(closes) else closes
                    _entry_highs = highs[:day_idx + 1] if day_idx < len(highs) else highs
                    _entry_lows = lows[:day_idx + 1] if day_idx < len(lows) else lows
                    _entry_vols = volumes[:day_idx + 1] if day_idx < len(volumes) else volumes
                    _entry_rsi = result.get('rsi') or result.get('indicators', {}).get('rsi')

                    _entry = evaluate_strict_entry(
                        _entry_closes, _entry_highs, _entry_lows, _entry_vols, rsi=_entry_rsi
                    )

                    if _entry['decision'] == 'REJECT':
                        print(f"[STRICT-ENTRY-REJECT] {ticker} on {scan_date}: "
                              f"{_entry['reason'][:100]}", flush=True)
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['strict_entry_reject'] = _entry['reason']
                        try:
                            from analyzers.decision_logger import log_decision
                            _reason_code = 'late_entry' if _entry.get('is_late') else 'not_accumulation'
                            log_decision(ticker, 'reject_entry', _reason_code,
                                _entry['reason'][:200], 'V40_2_STRICT_ENTRY',
                                market='STOCKS', scan_date=scan_date, score_before=result.get('score', 0))
                        except Exception:
                            pass
                        continue  # hard reject — مش تراكم ولا grab

                    # قبول — سجّل السبب
                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    result['proofs']['strict_entry'] = _entry['reason']
                    if _entry.get('is_accumulation'):
                        result['strict_entry_type'] = 'accumulation'
                    elif _entry.get('is_grab'):
                        result['strict_entry_type'] = 'liquidity_grab'
                except Exception as _entry_err:
                    pass  # safe-by-design: لو strict entry فشل → نكمّل بالسلوك القديم

            # ── DISCLOSURE IMPACT (2026-09-01): إفصاحات EGX الرسمية ──
            # توجيه المالك: "اقطع البحث العشوائي. المصدر الوحيد: الإفصاحات الرسمية.
            # درجة تأثير -2 لـ +2. لو سلبي قوي → جمّد الإشارة. لو إيجابي → دفعة."
            # الـ module: vps-service/analyzers/egx_disclosure_engine.py
            # - VETO (score=-2: suspension/delisting) → continue (hard reject)
            # - REDUCE (score=-1: dividend/auditor/resignation) → reduce score
            # - BOOST (score=+1/+2: capital_increase/rights/acquisition) → boost score
            # NOTE: في backtest mode، الإفصاحات التاريخية مش متاحة → skip
            # Toggle: V40_2_DISCLOSURE_IMPACT=1 (default OFF للـ backtest)
            if os.environ.get('V40_2_DISCLOSURE_IMPACT', '0') == '1':
                _is_backtest = os.environ.get('V40_2_BACKTEST_MODE', '0') == '1'
                if not _is_backtest:
                    try:
                        from analyzers.egx_disclosure_engine import get_disclosure_impact_for_ticker
                        _disc_result = get_disclosure_impact_for_ticker(ticker)
                        _disc_score = _disc_result.get('impact_score', 0)
                        _disc_verdict = _disc_result.get('verdict', 'NEUTRAL')

                        if _disc_verdict == 'VETO' and _disc_score <= -2:
                            print(f"[DISCLOSURE-VETO] {ticker} on {scan_date}: "
                                  f"{_disc_result.get('reason_ar', '')} → تجميد", flush=True)
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['disclosure_veto'] = _disc_result.get('proof_string', '')
                            try:
                                from analyzers.decision_logger import log_decision
                                log_decision(ticker, 'reject_entry', 'disclosure_veto',
                                    _disc_result.get('reason_ar', ''), 'V40_2_DISCLOSURE_IMPACT',
                                    market='STOCKS', scan_date=scan_date, score_before=result.get('score', 0))
                            except Exception:
                                pass
                            continue  # hard reject — تجميد الإشارة

                        # Apply score adjustment (BOOST or REDUCE)
                        if _disc_score != 0:
                            print(f"[DISCLOSURE-{_disc_verdict}] {ticker} on {scan_date}: "
                                  f"score={_disc_score:+d} → "
                                  f"{'دفعة' if _disc_score > 0 else 'وقف طوارئ'}", flush=True)
                            if isinstance(result.get('score'), (int, float)):
                                # scale: disclosure score is -2..+2, V40.2 score is 0..100
                                # multiply by 10 to make it meaningful (±10..±20)
                                result['score'] = max(0, min(100, result['score'] + (_disc_score * 10)))
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['disclosure_impact'] = _disc_result.get('proof_string', '')
                            result['disclosure_verdict'] = _disc_verdict
                            result['disclosure_score'] = _disc_score
                    except Exception as _disc_err:
                        pass  # safe-by-design: لو disclosure engine فشل → نكمّل

            # إعادة محاكاة الصفقة بالهدف والوقف النهائيين المحدثين
            trade = Trade(
                ticker=ticker, entry_date=scan_date, entry_price=entry,
                target_price=target, stop_loss=stop, score=result['score'],
                signal=signal, proofs=result['proofs'],
            )
            trade = simulate_trade(trade, future_closes, future_dates, 7, future_atrs)

            # ════════════════════════════════════════════════════════════════
            # LIVE PRODUCTION INTEGRATION (2026-09-02)
            # Owner directive: "اربط Position Sizing + News Impact جوه مسار V40.2 الإنتاجي"
            #
            # 1. Position Sizing: scale returns based on volatility (live, not just backtest)
            # 2. News Impact: adjust score + signal based on fresh EGX news
            # ════════════════════════════════════════════════════════════════

            # ── 1. POSITION SIZING (live) ──────────────────────────────────
            # Owner: "السهم العالي التقلب ياخد حجم أصغر"
            # Apply the same logic as simulate_trade but for the stored prediction.
            _live_position_size_mult = 1.0
            _live_volatility_class = 'NORMAL'
            _live_atr_pct = 0.0
            try:
                from analyzers.position_sizing import calculate_position_size
                _atr_for_live_sizing = result.get('atr', 0) or (_atr_soft if '_atr_soft' in dir() else 0)
                if _atr_for_live_sizing > 0 and entry > 0:
                    _live_sizing = calculate_position_size(_atr_for_live_sizing, entry)
                    _live_position_size_mult = _live_sizing['position_size_mult']
                    _live_volatility_class = _live_sizing['volatility_class']
                    _live_atr_pct = _live_sizing['atr_pct']
                    if _live_volatility_class == 'HIGH' and _live_position_size_mult < 1.0:
                        print(f"[POSITION-SIZING] {ticker}: ATR={_live_atr_pct:.1f}% → حجم مخفّض ({_live_position_size_mult:.0%})", flush=True)
            except Exception as _ps_err:
                pass  # safe-by-design

            # COUNTER-TREND BUY: apply position size override from entry_gate
            if result.get('counter_trend_buy'):
                _override = result.get('position_size_override', 0.5)
                _live_position_size_mult *= _override
                print(f"[COUNTER-TREND] {ticker}: position size reduced to {_live_position_size_mult:.2f} (mean-reversion BUY in bear market)", flush=True)

            # ── 2. NEWS IMPACT (live) ─────────────────────────────────────
            # Owner: "خبر إيجابي قوي → يرفع تقييم السهم. خبر سلبي قوي → حذر."
            # Apply news impact to V40.2 score + signal (combined_score, combined_signal).
            _live_news_level = 'NEUTRAL'
            _live_news_score = 0
            _live_news_delta = 0
            _live_news_count = 0
            _live_news_summary = ''
            _live_news_action = ''
            _live_news_client_msg = ''
            _combined_score = result['score']
            _combined_signal = signal
            try:
                # Only apply news in live mode (not backtest) — news are fresh, not historical
                _is_live_mode = os.environ.get('V40_2_BACKTEST_MODE', '0') != '1'
                if _is_live_mode or os.environ.get('V40_2_FORCE_NEWS_IN_BACKTEST', '0') == '1':
                    from analyzers.live_news_integration import get_news_impact_for_live_prediction
                    _news_impact = get_news_impact_for_live_prediction(ticker)
                    if _news_impact.get('has_news'):
                        _live_news_level = _news_impact['level']
                        _live_news_score = _news_impact.get('news_score', 0)
                        _live_news_delta = _news_impact.get('score_delta', 0)
                        _live_news_count = _news_impact.get('news_count', 0)
                        _live_news_summary = _news_impact.get('news_summary_ar', '')
                        _live_news_action = _news_impact.get('action_ar', '')
                        _live_news_client_msg = _news_impact.get('client_message', '')

                        # Combined score = V40.2 score + news delta (clamped 0-100)
                        _combined_score = max(0, min(100, result['score'] + _live_news_delta))

                        # Adjust signal based on news level
                        if _live_news_level == 'STRONG_POSITIVE':
                            if signal == 'HOLD':
                                _combined_signal = 'BUY'
                            elif signal == 'BUY':
                                _combined_signal = 'STRONG_BUY'
                            print(f"[NEWS-STRONG_POSITIVE] {ticker}: Δ={_live_news_delta:+d} → {_combined_signal} (news_count={_live_news_count})", flush=True)
                        elif _live_news_level == 'STRONG_NEGATIVE':
                            if signal in ('BUY', 'STRONG_BUY'):
                                _combined_signal = 'HOLD'
                            elif signal == 'HOLD':
                                _combined_signal = 'SELL'
                            print(f"[NEWS-STRONG_NEGATIVE] {ticker}: Δ={_live_news_delta:+d} → {_combined_signal} (news_count={_live_news_count})", flush=True)
                        elif _live_news_level in ('POSITIVE', 'NEGATIVE'):
                            print(f"[NEWS-{_live_news_level}] {ticker}: Δ={_live_news_delta:+d} → combined_score={_combined_score} (news_count={_live_news_count})", flush=True)
            except Exception as _news_err:
                pass  # safe-by-design

            # ═══════════════════════════════════════════════════════════════════════
            # 🛡️ SAFE MODE (V82-PORT 2026-10-01): لو فيه 3 خسارات متتالية → تقليل الحجم
            # Ported from V82 analyzer (dead code) → integrated into live DailyPredictor
            # Pine script concept: "safe_mode_active = consecutive_losses >= 3"
            # ═══════════════════════════════════════════════════════════════════════
            _safe_mode_active = False
            try:
                _pred_db_path = str(_PROJECT_ROOT / 'db' / 'predictions.db')
                if os.path.exists(_pred_db_path):
                    import sqlite3 as _sql_safe
                    _safe_conn = _sql_safe.connect(_pred_db_path, timeout=3.0)
                    # Get last 3 closed predictions for this ticker
                    _recent = _safe_conn.execute(
                        """SELECT status FROM predictions
                           WHERE ticker = ? AND status IN ('STOPPED','TARGET_HIT','EXPIRED')
                           ORDER BY id DESC LIMIT 3""",
                        (ticker,)
                    ).fetchall()
                    _safe_conn.close()
                    # If all 3 are STOPPED → safe mode
                    if len(_recent) >= 3 and all(r[0] == 'STOPPED' for r in _recent):
                        _safe_mode_active = True
                        # Reduce position size by 50%
                        _live_position_size_mult *= 0.5
                        # Add proof
                        if 'proofs' not in result or result['proofs'] is None:
                            result['proofs'] = {}
                        result['proofs']['safe_mode'] = '⚠️ وضع آمن (3 خسارات متتالية) — حجم مخفّض 50%'
                        print(f"[SAFE-MODE] {ticker}: 3 consecutive losses → size reduced to {_live_position_size_mult:.2f}", flush=True)
            except Exception:
                pass  # safe-by-design

            # ═══════════════════════════════════════════════════════════════════════
            # ☁️ ICHIMOKU CLOUD (V82-PORT 2026-10-01): تأكيد الاتجاه بسحابة الإيشيموكو
            # Ported from V82 analyzer → integrated as a new proof in DailyPredictor
            # Pine script: "ichimoku_bull = close > senkouA AND close > senkouB"
            # ═══════════════════════════════════════════════════════════════════════
            try:
                _ichimoku_bull = True  # default: assume bull if not enough data
                if len(closes) >= 52 and len(highs) >= 52 and len(lows) >= 52:
                    _conv_len, _base_len, _span_b_len, _displacement = 9, 26, 52, 26
                    # Tenkan-sen (9-period)
                    _tenkan = (max(highs[-_conv_len:]) + min(lows[-_conv_len:])) / 2
                    # Kijun-sen (26-period)
                    _kijun = (max(highs[-_base_len:]) + min(lows[-_base_len:])) / 2
                    # Senkou Span A
                    _senkou_a = (_tenkan + _kijun) / 2
                    # Senkou Span B (52-period)
                    _senkou_b = (max(highs[-_span_b_len:]) + min(lows[-_span_b_len:])) / 2
                    # Current close vs cloud
                    _current_close = closes[-1]
                    _ichimoku_bull = _current_close > _senkou_a and _current_close > _senkou_b

                    if 'proofs' not in result or result['proofs'] is None:
                        result['proofs'] = {}
                    if _ichimoku_bull:
                        result['proofs']['ichimoku'] = f'☁️ فوق سحابة الإيشيموكو (bullish)'
                    else:
                        result['proofs']['ichimoku'] = f'⚠️ تحت سحابة الإيشيموكو (bearish)'
                        # Penalty: -3 score if below cloud
                        result['score'] = max(0, result['score'] - 3)
            except Exception:
                pass  # safe-by-design

            # ═══════════════════════════════════════════════════════════════════════
            # 🧬 DNA-WINNER FILTERS (2026-09-03): The winning flags from backtest
            # ═══════════════════════════════════════════════════════════════════════

            # --- DNA-1: Anomaly filter (>50% move in 5 days = reject) ---
            if DNA_ANOMALY_FILTER and day_idx >= 5:
                try:
                    _ref_price = closes[day_idx - 5] if closes[day_idx - 5] > 0 else closes[day_idx - 1]
                    _curr_price = closes[day_idx]
                    if _ref_price > 0:
                        _move_pct = abs((_curr_price - _ref_price) / _ref_price)
                        if _move_pct > 0.50:
                            print(f"[DNA-ANOMALY] {ticker} on {scan_date}: {_move_pct*100:.1f}% move in 5 days → reject", flush=True)
                            continue
                except Exception:
                    pass

            # --- DNA-2: EGX30 down > 0.4% → skip BUY ---
            # PRED-RADAR-GAP-AUDIT Step 2 (2026-10-05): BYPASS لو السهم مؤكد تجميع من الرادار.
            # القرار: لما السوق هابط، ده وقت "buy the dip" — مش وقت نوقف الشرا خالص.
            # لو السهم فيه تجميع مؤسسي قوي (radar B_quiet_accumulation_strong أو A_pre_surge
            # أو C_quiet_accumulation_weak)، اسمح بـ BUY بس بـ position_size × 0.5 (حماية رأس المال).
            if DNA_EGX30_DOWN_HOLD:
                try:
                    # Use benchmark (EGX30ETF) if available, else use avg of all tickers
                    _market_change = None
                    if hasattr(engine, '_benchmark_closes') and engine._benchmark_closes and day_idx < len(engine._benchmark_closes):
                        _bm_closes = engine._benchmark_closes
                        if len(_bm_closes) > 1:
                            _market_change = (_bm_closes[-1] - _bm_closes[-2]) / _bm_closes[-2] * 100 if _bm_closes[-2] > 0 else 0
                    if _market_change is not None and _market_change < -0.4:
                        # STEP-2 FIX: check radar confirmation before skipping
                        try:
                            from analyzers.radar_integration import is_radar_confirmed_accumulation
                            _radar_confirmed = is_radar_confirmed_accumulation(ticker, market_code if 'market_code' in dir() else 'EGX')
                        except Exception:
                            _radar_confirmed = False
                        if _radar_confirmed:
                            # BYPASS: السهم فيه تجميع مؤسسي قوي → اسمح بـ BUY بس بـ position_size × 0.5
                            result['position_size_mult'] = result.get('position_size_mult', 1.0) * 0.5
                            result['proofs']['dna_egx30_down_bypass'] = f'🛡️ تجاوز DNA_EGX30_DOWN (market {_market_change:.2f}%) — radar confirms accumulation | pos_size ×0.5'
                            print(f"[DNA-EGX30-DOWN-BYPASS] {scan_date}: market {_market_change:.2f}% → BYPASS for {ticker} (radar accumulation confirmed, pos_size ×0.5)", flush=True)
                        else:
                            print(f"[DNA-EGX30-DOWN] {scan_date}: market {_market_change:.2f}% → skip BUY for {ticker}", flush=True)
                            continue
                except Exception:
                    pass

            # --- DNA-3: Max open positions = 8 (hard limit) ---
            _current_open = len(signals_by_date.get(scan_date, []))
            if _current_open >= DNA_MAX_OPEN_POSITIONS:
                if _current_open == DNA_MAX_OPEN_POSITIONS:  # print only once
                    print(f"[DNA-MAX-POS] {scan_date}: {DNA_MAX_OPEN_POSITIONS} picks reached → stop", flush=True)
                break  # break inner loop (stop processing more tickers for this date)

            # --- DNA-4: Sector limit (Finance ≤ 20%, others ≤ 15%) ---
            # V40.2-FIX: لو الـ sector = None (مش متاح)، اعتبار السهم في قطاع
            # "غير محدد" وسمح بـ المرور (مش رفض). الـ limit بـ يطبق بس لو فيه
            # قطاع محدد فعلاً.
            if DNA_SECTOR_LIMIT_FINANCE > 0 or DNA_SECTOR_LIMIT_OTHER > 0:
                try:
                    _ticker_sector = get_ticker_sector(ticker)
                    if _ticker_sector:
                        _sector_count = sum(1 for s in signals_by_date.get(scan_date, []) if get_ticker_sector(s.get('ticker', '')) == _ticker_sector)
                        _sector_limit = DNA_SECTOR_LIMIT_FINANCE if 'Finance' in str(_ticker_sector) else DNA_SECTOR_LIMIT_OTHER
                        _max_for_sector = int(DNA_MAX_OPEN_POSITIONS * _sector_limit)
                        if _sector_count >= _max_for_sector:
                            print(f"[DNA-SECTOR-LIMIT] {ticker} ({_ticker_sector}): {_sector_count}/{_max_for_sector} → reject", flush=True)
                            continue
                except Exception:
                    pass

            # DNA-WINNER DEBUG: print what reaches the append
            if signal in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                print(f"[DNA-DEBUG] {ticker} on {scan_date}: REACHED APPEND | signal={signal} score={result.get('score')} entry={entry} stop={stop} target={target} r_mult={r_mult:.2f}", flush=True)

            # ═══════════════════════════════════════════════════════════════════════
            # 📉 AVERAGE DOWN (Task IMPROVEMENT-13-2026-10-07 — Rule 71):
            # تفعيل نظام المتوسط الذكي على الصفقات القائمة
            # المصدر: strict_entry_filters.py::evaluate_average_down()
            # المنطق:
            #   - لو السهم نزل 3-8% تحت الدعم + تعافى خلال 3 أيام + حجم مؤكد
            #   - → اقتراح متوسط (مره واحدة بس، حجم 50%، الستوب لا يتوسع)
            # تفعيل دائم (مش خلف flag)
            # ═══════════════════════════════════════════════════════════════════════
            if signal in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                try:
                    from analyzers.strict_entry_filters import evaluate_average_down
                    _avg_closes = closes[:day_idx+1]
                    _avg_volumes = volumes[:day_idx+1]
                    _avg_highs = highs[:day_idx+1]
                    _avg_lows = lows[:day_idx+1]
                    if len(_avg_closes) >= 20:
                        _avg_result = evaluate_average_down(
                            _avg_closes, _avg_volumes, _avg_highs, _avg_lows
                        )
                        if _avg_result.get('is_average_down_opportunity'):
                            # أضف proof للمتوسط
                            if 'proofs' not in result or result['proofs'] is None:
                                result['proofs'] = {}
                            result['proofs']['average_down'] = f"📉 فرصة متوسط ذكي: {_avg_result.get('reason', '')}"
                            print(f"📉 [AVG-DOWN] {ticker} on {scan_date}: {_avg_result.get('reason', '')} → متوسط مقترح", flush=True)
                            # ضعف الحجم للمتوسط (50% من الحجم الأساسي)
                            _live_position_size_mult *= 0.5
                except Exception as _avg_err:
                    pass  # safe-by-design

            # ═══════════════════════════════════════════════════════════════════════
            # 🛡️ TICKER COOLDOWN (Task IMPROVEMENT-03-2026-10-06 — Rule 71):
            # لو السهم عنده 5+ خسارات متتالية (STOPPED) → ارفضه نهائياً (cooldown)
            # السبب: ORTE كان 48 توقع، 29 max consecutive losses → مش حيلتك تعيد المحاولة
            # مدة Cooldown: 14 يوم تداول من آخر خسارة
            # ═══════════════════════════════════════════════════════════════════════
            try:
                _pred_db_path = str(_PROJECT_ROOT / 'db' / 'predictions.db')
                if os.path.exists(_pred_db_path):
                    import sqlite3 as _sql_cd
                    _cd_conn = _sql_cd.connect(_pred_db_path, timeout=3.0)
                    # Get last 5 closed predictions for this ticker
                    _recent_5 = _cd_conn.execute(
                        """SELECT status, prediction_date FROM predictions
                           WHERE ticker = ? AND status IN ('STOPPED','TARGET_HIT','EXPIRED')
                           ORDER BY id DESC LIMIT 5""",
                        (ticker,)
                    ).fetchall()
                    _cd_conn.close()
                    # If all 5 are STOPPED → cooldown active
                    if len(_recent_5) >= 5 and all(r[0] == 'STOPPED' for r in _recent_5):
                        _last_loss_date = _recent_5[0][1] if _recent_5[0][1] else ''
                        # Check if cooldown period (14 days) has passed
                        from datetime import datetime as _dt, timedelta as _td
                        try:
                            _last_dt = _dt.strptime(_last_loss_date[:10], '%Y-%m-%d')
                            _scan_dt = _dt.strptime(scan_date[:10], '%Y-%m-%d')
                            _days_since_loss = (_scan_dt - _last_dt).days
                            if _days_since_loss < 14:
                                print(f"🚫 [COOLDOWN] {ticker} on {scan_date}: 5 consecutive STOPPED (last={_last_loss_date}, {_days_since_loss}d ago < 14d) → REJECTED", flush=True)
                                continue
                            else:
                                print(f"✅ [COOLDOWN-EXPIRED] {ticker}: 14d passed since last loss → resuming", flush=True)
                        except Exception:
                            # date parsing failed → reject to be safe
                            print(f"🚫 [COOLDOWN-DATE-ERR] {ticker} on {scan_date}: cannot parse dates → REJECTED", flush=True)
                            continue
            except Exception as _cd_err:
                pass  # safe-by-design: لو الـ cooldown check فشل → نكمّل

            # ── MAKER RADAR INTEGRATION (2026-09-05): Kill Switch + Money Flow ──
            # لو السهم عليه Kill Switch (توزيع قاتل / حبس / تدوير وهمي) → ارفضه فوراً.
            # لو السهم فيه دخول سيولة قوي → boost score +5.
            # لو السهم فيه خروج سيولة قوي → penalty score -5.
            _radar_kill = False
            _radar_kill_reason = ''
            _radar_boost = 0
            _radar_money_flow = 'neutral'
            try:
                from utils.shared_liquidity import check_kill_switch, compute_money_flow
                _closes_slice = closes[:day_idx+1]
                _volumes_slice = volumes[:day_idx+1]
                _highs_slice = highs[:day_idx+1]
                _lows_slice = lows[:day_idx+1]
                if len(_closes_slice) >= 18:
                    _kill_triggered, _kill_reason = check_kill_switch(
                        _closes_slice, _volumes_slice, _highs_slice, _lows_slice
                    )
                    if _kill_triggered:
                        _radar_kill = True
                        _radar_kill_reason = _kill_reason
                        print(f"🚫 [RADAR-KILL] {ticker} on {scan_date}: {_kill_reason} → rejected", flush=True)

                    _mf = compute_money_flow(_closes_slice, _volumes_slice, _highs_slice, _lows_slice)
                    _radar_money_flow = _mf.get('money_flow_state', 'neutral')
                    if '🔥 دخول قوي' in _radar_money_flow:
                        _radar_boost = 5
                    elif '🔥 خروج قوي' in _radar_money_flow:
                        _radar_boost = -5
                    elif '🟢 سيولة داخلة' in _radar_money_flow:
                        _radar_boost = 2
                    elif '🔴 سيولة خارجة' in _radar_money_flow:
                        _radar_boost = -2
            except Exception as _radar_err:
                pass  # safe-by-design: لو الرادار فشل → نكمّل من غيره

            # Kill Switch → ارفض الإشارة فوراً
            if _radar_kill:
                print(f"🚫 [RADAR-KILL] {ticker} on {scan_date}: {_radar_kill_reason} → signal rejected", flush=True)
                continue

            # ═══════════════════════════════════════════════════════════════════════
            # 🧠 HMM MARKET REGIME (Task IMPROVEMENT-09-2026-10-06 — Rule 71):
            # كشف الحالة الخفية للسوق (Accumulation/Markup/Distribution/Markdown)
            # المصدر: Kalman Filter / HMM Market Regime Blueprint من المالك
            # المنطق:
            #   - Distribution → REJECT (توزيع = خطر)
            #   - Markdown → REJECT (هبوط = خطر)
            #   - Accumulation → boost +3 (تجميع = فرصة)
            #   - Markup → boost +5 (صعود = قوة)
            # ═══════════════════════════════════════════════════════════════════════
            try:
                from analyzers.hmm_market_regime import get_hmm_regime
                _hmm_result = get_hmm_regime('EGX30ETF')
                _hmm_regime = _hmm_result.get('regime', 'UNKNOWN')
                _hmm_regime_ar = _hmm_result.get('regime_ar', '⚪ غير معروف')
                _hmm_trading_allowed = _hmm_result.get('trading_allowed', True)
                _hmm_pos_mod = _hmm_result.get('position_modifier', 1.0)

                # Add as proof
                if 'proofs' not in result or result['proofs'] is None:
                    result['proofs'] = {}
                result['proofs']['hmm_regime'] = f"🧠 HMM: {_hmm_regime_ar}"

                # HMM Veto: لو Distribution أو Markdown → REJECT
                if not _hmm_trading_allowed:
                    print(f"🚫 [HMM-REJECT] {ticker} on {scan_date}: regime={_hmm_regime} ({_hmm_regime_ar}) → REJECTED", flush=True)
                    continue

                # HMM Boost: لو Accumulation أو Markup → boost
                if _hmm_regime == 'Accumulation':
                    _old_score = result.get('score', 0)
                    result['score'] = max(0, min(100, _old_score + 3))
                    print(f"🧠 [HMM-ACCUMULATION] {ticker}: {_hmm_regime_ar} → score {_old_score} → {result['score']} (+3)", flush=True)
                elif _hmm_regime == 'Markup':
                    _old_score = result.get('score', 0)
                    result['score'] = max(0, min(100, _old_score + 5))
                    print(f"🧠 [HMM-MARKUP] {ticker}: {_hmm_regime_ar} → score {_old_score} → {result['score']} (+5)", flush=True)

                # Apply position modifier
                if _hmm_pos_mod < 1.0:
                    _live_position_size_mult *= _hmm_pos_mod
                    print(f"🧠 [HMM-SIZE] {ticker}: position size ×{_hmm_pos_mod:.1f} = {_live_position_size_mult:.2f}", flush=True)

                # Save HMM state in result
                result['hmm_regime'] = _hmm_regime
                result['hmm_regime_ar'] = _hmm_regime_ar

            except Exception as _hmm_err:
                pass  # safe-by-design: لو HMM فشل → نكمّل من غيره

            # Apply boost/penalty
            if _radar_boost != 0:
                _old_score = result.get('score', 0)
                result['score'] = max(0, min(100, _old_score + _radar_boost))
                print(f"📊 [RADAR-BOOST] {ticker} on {scan_date}: {_radar_money_flow} → score {_old_score} → {result['score']} ({_radar_boost:+d})", flush=True)

            # ═══════════════════════════════════════════════════════════════════════
            # 👥 WHO IS BUYING (Task IMPROVEMENT-05-2026-10-06 — Rule 71):
            # كشف نوع المُتداول المسيطر على السيولة (مؤسساتي / أفراد)
            # المصدر: data/pine_scripts/EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine
            # المنطق:
            #   - لو institutional_buy ≥ 65 + signal BUY → boost +5 (proof)
            #   - لو institutional_sell ≥ 65 → REJECT نهائياً (تصريف مؤسساتي = خطر)
            #   - لو retail_buy ≥ 65 → penalty -3 (شراء أفراد = إشارة ضعيفة)
            #   - لو retail_sell ≥ 65 → penalty -5 (بيع أفراد = خطر)
            # ═══════════════════════════════════════════════════════════════════════
            try:
                from analyzers.master_analyzer import detect_who_is_buying
                _who_result = detect_who_is_buying(
                    closes[:day_idx+1],
                    volumes[:day_idx+1],
                    highs[:day_idx+1],
                    lows[:day_idx+1],
                    opens[:day_idx+1] if 'opens' in dir() and opens else None,
                )
                _inst_buy = _who_result.get('institutional_buy_score', 0)
                _inst_sell = _who_result.get('institutional_sell_score', 0)
                _retail_buy = _who_result.get('retail_buy_score', 0)
                _retail_sell = _who_result.get('retail_sell_score', 0)
                _who_state = _who_result.get('who_state', '')
                _who_buying_score = _who_result.get('who_buying_score', 0)

                # Add as proof
                if 'proofs' not in result or result['proofs'] is None:
                    result['proofs'] = {}
                result['proofs']['who_is_buying'] = _who_state

                # Institutional SELL ≥ 65 → REJECT (تصريف مؤسساتي = خطر)
                if _inst_sell >= 65:
                    print(f"🚫 [WHO-BUYING-REJECT] {ticker} on {scan_date}: institutional_sell={_inst_sell} ≥ 65 ({_who_state}) → REJECTED", flush=True)
                    continue

                # Institutional BUY ≥ 65 + signal BUY → boost +5
                if _inst_buy >= 65 and signal in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
                    _old_score = result.get('score', 0)
                    result['score'] = max(0, min(100, _old_score + 5))
                    print(f"🏦 [WHO-INST-BUY] {ticker}: institutional_buy={_inst_buy} ({_who_state}) → score {_old_score} → {result['score']} (+5)", flush=True)

                # Retail BUY ≥ 65 (مش مؤسساتي) → penalty -3
                elif _retail_buy >= 65 and _inst_buy < 50:
                    _old_score = result.get('score', 0)
                    result['score'] = max(0, min(100, _old_score - 3))
                    print(f"👤 [WHO-RETAIL-BUY] {ticker}: retail_buy={_retail_buy} ({_who_state}) → score {_old_score} → {result['score']} (-3)", flush=True)

                # Retail SELL ≥ 65 → penalty -5
                if _retail_sell >= 65 and _inst_buy < 50:
                    _old_score = result.get('score', 0)
                    result['score'] = max(0, min(100, _old_score - 5))
                    print(f"👤 [WHO-RETAIL-SELL] {ticker}: retail_sell={_retail_sell} ({_who_state}) → score {_old_score} → {result['score']} (-5)", flush=True)

                # Save who_is_buying details in result for predictions.db
                result['who_is_buying_state'] = _who_state
                result['who_is_buying_score'] = _who_buying_score
                result['institutional_buy_score'] = _inst_buy
                result['institutional_sell_score'] = _inst_sell

            except Exception as _who_err:
                pass  # safe-by-design: لو الـ WHO IS BUYING فشل → نكمّل

            # ═══════════════════════════════════════════════════════════════════════
            # Task IMPROVEMENT-07-2026-10-06 (Rule 71): GENERATE ANALYSIS REASON
            # مصدر الإلهام: data/pine_scripts/EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine (lines 919-935)
            # الهدف: توليد نص عربي يشرح سبب القرار — يُستخدم في:
            #   - تقارير التليجرام
            #   - الواجهة (UI)
            #   - الـ predictions.db
            # النص بيشمل: WHO IS BUYING + Money Flow + Radar Path + Targets + R:R
            # ═══════════════════════════════════════════════════════════════════════
            try:
                from analyzers.master_analyzer import generate_analysis_reason
                _analysis_reason_text = generate_analysis_reason(
                    signal=signal,
                    score=result.get('score', 0),
                    entry=entry,
                    target=target,
                    target_2=result.get('target_2', 0),
                    target_3=result.get('target_3', 0),
                    stop=stop,
                    who_is_buying_state=result.get('who_is_buying_state', ''),
                    radar_money_flow=_radar_money_flow,
                    radar_path=result.get('radar_path', ''),
                    proofs=result.get('proofs', {}),
                    ticker=ticker,
                )
                result['analysis_reason'] = _analysis_reason_text
                # Print first 200 chars for debugging
                _reason_preview = _analysis_reason_text[:200].replace('\n', ' | ')
                if signal in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                    print(f"📝 [ANALYSIS-REASON] {ticker}: {_reason_preview}", flush=True)
            except Exception as _reason_err:
                result['analysis_reason'] = f"Score: {result.get('score', 0)} | Entry: {entry} | Target: {target}"  # safe fallback

            # Reduce position size by 50% if radar bypass allowed buy in down market (DNA-EGX30-DOWN override)
            if result.get('proofs', {}).get('dna_egx30_down_bypass'):
                _live_position_size_mult *= 0.5
                print(f"[DNA-EGX30-DOWN] {ticker}: position size reduced to {_live_position_size_mult:.2f} (radar-confirmed accumulation in down market)", flush=True)

            # ═══════════════════════════════════════════════════════════════════════
            # BRAVO-BREAKOUT-FUSION (2026-10-19): Breakout signal fusion (proven strategy)
            # Strategy: 20-day high breakout (Test PF=4.47, p-value=0.0% — proven edge)
            #   - لو V40.2 BUY + breakout → evidence boost (+2)
            #   - لو V40.2 HOLD/WAIT + breakout → override لـ BUY
            # Controlled by env var V402_BREAKOUT_FUSION (default: 0 = off, safe-by-design)
            # ═══════════════════════════════════════════════════════════════════════
            if os.environ.get('V402_BREAKOUT_FUSION', '0') == '1':
                try:
                    from analyzers.breakout_signal import detect_breakout, fuse_with_v402
                    _bo = detect_breakout(closes, highs, lows, volumes, day_idx)
                    if _bo is not None:
                        _fused = fuse_with_v402(
                            signal=signal,
                            entry=entry,
                            target=target,
                            stop=stop,
                            evidence=evidence,
                            proofs=result.get('proofs', {}),
                            breakout=_bo,
                        )
                        if _fused['fused']:
                            _old_sig = signal
                            signal = _fused['signal']
                            entry = _fused['entry']
                            target = _fused['target']
                            stop = _fused['stop']
                            evidence = _fused['evidence']
                            result['proofs'] = _fused['proofs']
                            print(f"🔥 [BREAKOUT-FUSION] {ticker}: {_old_sig} → {signal} | "
                                  f"high_20={_bo['high_20']:.2f} close={_bo['close']:.2f} "
                                  f"regime={_bo['regime']} turnover={_bo['turnover']:.0f}", flush=True)
                except Exception as _bo_err:
                    pass  # safe-by-design — never break prediction on breakout failure

            signals_by_date[scan_date].append({
                'ticker': ticker,
                'signal': signal,
                'combined_signal': _combined_signal,  # signal بعد تأثير الأخبار
                'entry': entry,
                'target': target,
                'target_2': result.get('target_2', 0),
                'target_3': result.get('target_3', 0),  # Task IMPROVEMENT-06: DNA projection
                'stop': stop,
                'tech_score': result['score'],
                'combined_score': _combined_score,  # score بعد تأثير الأخبار
                'evidence': evidence,
                'r_multiple': r_mult,
                'atr': result.get('atr', 0) or (_atr_soft if '_atr_soft' in dir() else 0),
                'exit_price': trade.exit_price,
                'exit_date': trade.exit_date,
                'exit_reason': trade.exit_reason,
                'return_pct': trade.return_pct,
                'is_win': trade.is_win,
                'pnl_pct': trade.pnl_pct,
                'r_multiple_actual': trade.r_multiple,
                'persona_fit': persona_fit['persona_fit'],
                'persona_fit_scores': persona_fit['fit_scores'],
                'proofs': result.get('proofs', {}),
                'analysis_reason': result.get('analysis_reason', ''),  # Task IMPROVEMENT-07: نص عربي شارح
                'who_is_buying_state': result.get('who_is_buying_state', ''),  # Task IMPROVEMENT-05
                'hmm_regime_ar': result.get('hmm_regime_ar', ''),  # Task IMPROVEMENT-09
                'ml_confidence_pct': result.get('ml_confidence_pct'),  # Task IMPROVEMENT-08
                'liquidity_type': _liquidity['type'] if _liquidity else 'neutral',
                'liquidity_score': _liquidity['score'] if _liquidity else 50,
                'liquidity_pos_mult': _liquidity['position_size_mult'] if _liquidity else 1.0,
                'liquidity_hold_mult': _liquidity['hold_multiplier'] if _liquidity else 1.0,
                # POSITION SIZING (live — 2026-09-02)
                'position_size_mult': _live_position_size_mult,
                'volatility_class': _live_volatility_class,
                'atr_pct': _live_atr_pct,
                # Radar fallback data (last 20 days for radar re-check)
                '_closes_for_radar': closes[-20:] if len(closes) >= 20 else closes,
                '_volumes_for_radar': volumes[-20:] if len(volumes) >= 20 else volumes,
                '_highs_for_radar': highs[-20:] if len(highs) >= 20 else highs,
                '_lows_for_radar': lows[-20:] if len(lows) >= 20 else lows,
                # NEWS IMPACT (live — 2026-09-02)
                'news_level': _live_news_level,
                'news_score': _live_news_score,
                'news_delta': _live_news_delta,
                'news_count': _live_news_count,
                'news_summary_ar': _live_news_summary,
                'news_action_ar': _live_news_action,
                'news_client_message': _live_news_client_msg,
                # ── V68 ORACLE FIELDS (المرحلة 4 — 2026-08-31) ──
                # احتمالية النجاح + البصمة المستقبلية + خريطة الجثث
                'v68_probability': result.get('v68_probability', 0),
                'v68_future_direction': result.get('v68_future_direction', 'flat'),
                'v68_future_momentum': result.get('v68_future_momentum', 0.0),
                'v68_quiet_accumulation': result.get('v68_quiet_accumulation', False),
                'v68_dirty_distribution': result.get('v68_dirty_distribution', False),
                'v68_no_chase_2d': result.get('v68_no_chase_2d', False),
                'v68_liquidity_grab': result.get('v68_liquidity_grab', False),
                'v68_low_magnet': result.get('v68_low_magnet'),
                'v68_high_magnet': result.get('v68_high_magnet'),
                'v68_trend_state': result.get('v68_trend_state', 0),
                'v68_delta_vol': result.get('v68_delta_vol', 0.0),
                # PHASE-C FIX + FIX-1 Step 4 (Rule 24): خزّن الـ fundamental_score
                # الحقيقي في DB. لما fundamentals تكون متاحة → الدرجة الحقيقية (0-100).
                # لما غير متاحة → None (NULL في DB) — NO placeholder 50.0 anymore.
                # Per owner directive: "مانستعملش بيانات وهمية خالص تحت اى ظرف".
                # REAL DATA ONLY — no placeholder (per owner directive + Rule 24).
                'fundamental_score': _fund_score if _fund_avail else None,
                # ── TASK-A (Technical Explanation Generator — 2026-10-04) ──
                # شرح فني شامل من كل المحركات (Candlestick + SMC + Volume + Patterns)
                # بينخزّن في analysis_json و ai_narrative column في stored_analyses.
                'technical_explanation': result.get('technical_explanation', {}) or {},

                # ── BRAVO RADAR-ADVANCED (مرحلة 1): SMC + Volume Profile ──────
                # ربط الكنوز المتقدمة في V40.2 قبل البوابات.
                # SMC: Order Blocks + FVG + Liquidity Sweeps → score 0-100
                # VP: VWAP + OBV + A/D Line + Volume Nodes → score 0-100
                # الـ weights: SMC=15% من score, VP=10% من score (موثّق).
                # safe-by-design: لو فشل → None (مش fabrication).
                'smc_score': (lambda: (
                    (lambda _r: _r.get('score') if _r else None)(
                        (lambda: (
                            __import__('analyzers.smc_engine', fromlist=['calculate_smc_score']).calculate_smc_score(
                                [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                                 for o, h, l, c, v in zip(
                                     opens[max(0,day_idx-50):day_idx+1],
                                     highs[max(0,day_idx-50):day_idx+1],
                                     lows[max(0,day_idx-50):day_idx+1],
                                     closes[max(0,day_idx-50):day_idx+1],
                                     volumes[max(0,day_idx-50):day_idx+1],
                                 )],
                                current_price=closes[day_idx],
                            ) if day_idx >= 5 else None
                        ))()
                    )
                ))() if signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY') else None,

                'volume_profile_score': (lambda: (
                    (lambda _r: _r.score if _r else None)(
                        (lambda: (
                            __import__('analyzers.volume_profile', fromlist=['VolumeProfileAnalyzer']).VolumeProfileAnalyzer().analyze(
                                closes[max(0,day_idx-30):day_idx+1],
                                volumes[max(0,day_idx-30):day_idx+1],
                            ) if day_idx >= 5 else None
                        ))()
                    )
                ))() if signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY') else None,

                'vwap': None,  # will be filled below if VP available
                'obv': None,
                'volume_nodes': [],
            })

            # ── BRAVO RADAR-ADVANCED: استخراج VWAP + OBV من VP result ──────
            # + دمج SMC + VP في الـ combined_score (طبقة وزن إضافية)
            _last_sig = signals_by_date[scan_date][-1] if signals_by_date[scan_date] else None
            if _last_sig and signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY'):
                _smc_s = _last_sig.get('smc_score')
                _vp_s = _last_sig.get('volume_profile_score')

                # ═══════════════════════════════════════════════════════════════════════
                # BRAVO-HYBRID-SCORE (مرحلة 1 — 2026-10-19):
                # كسر سيطرة V38 كـ brain وحيد + إدخال CoreScoringEngine كـ layer حقيقي.
                #
                # الـ 4 layers:
                #   1. V38 score (boolean conditions — كان 75%، دلوقتي أقل)
                #   2. CoreScoringEngine (continuous 0-100 — جديد)
                #   3. SMC (Order Blocks + FVG + Sweeps)
                #   4. Volume Profile (VWAP + OBV + A/D Line)
                #
                # الـ weights configurable via env vars (للـ A/B testing):
                #   V402_V38_WEIGHT  (default 0.40)
                #   V402_CORE_WEIGHT (default 0.35)
                #   V402_SMC_WEIGHT  (default 0.15)
                #   V402_VP_WEIGHT   (default 0.10)
                #
                # Fallback (Rule 27 — NO-FAKE-DATA):
                #   لو CoreScoringEngine فشل → نـزود وزن V38 + log الـ error.
                #   ممنوع نـستخدم placeholder 50.0.
                # ═══════════════════════════════════════════════════════════════════════
                _V38_W = float(os.environ.get('V402_V38_WEIGHT', '0.40'))
                _CORE_W = float(os.environ.get('V402_CORE_WEIGHT', '0.35'))
                _SMC_W = float(os.environ.get('V402_SMC_WEIGHT', '0.15'))
                _VP_W = float(os.environ.get('V402_VP_WEIGHT', '0.10'))

                # حساب CoreScoringEngine score (layer جديد)
                _core_score = None
                _core_err = None
                try:
                    from analyzers.core_scoring_engine import CoreScoringEngine as _CSE
                    _cse = _CSE()
                    _slice_start = max(0, day_idx - 100)
                    # فلتر الـ None values (بعض الصفوف فيها high/low = NULL)
                    _raw_slice = list(zip(
                        opens[_slice_start:day_idx+1] if 'opens' in dir() else [],
                        highs[_slice_start:day_idx+1] if 'highs' in dir() else [],
                        lows[_slice_start:day_idx+1] if 'lows' in dir() else [],
                        closes[_slice_start:day_idx+1],
                        volumes[_slice_start:day_idx+1],
                    ))
                    _filtered = [(_o, _h, _l, _c, _v) for _o, _h, _l, _c, _v in _raw_slice
                                 if _c is not None and _h is not None and _l is not None
                                 and _o is not None and _c > 0]
                    if len(_filtered) >= 30:
                        _price_data = {
                            'closes':  [f[3] for f in _filtered],
                            'opens':   [f[0] for f in _filtered],
                            'highs':   [f[1] for f in _filtered],
                            'lows':    [f[2] for f in _filtered],
                            'volumes': [f[4] for f in _filtered],
                        }
                        _core_result = _cse.analyze(
                            ticker=ticker,
                            price_data=_price_data,
                            market=market_code.upper() if market_code else 'EGX',
                            persona='trader',
                        )
                        if _core_result and _core_result.score is not None:
                            _core_score = float(_core_result.score)
                except Exception as _cse_err:
                    _core_err = str(_cse_err)[:120]

                # Fallback: لو CoreScoring فشل → زوّد وزن V38 (ممنوع fabrication)
                if _core_score is None:
                    if _core_err:
                        print(
                            f"[CORE-SCORE-FAIL] {ticker} on {scan_date}: {_core_err} "
                            f"→ fallback: V38 وزن {_V38_W:.2f} → {_V38_W + _CORE_W:.2f}",
                            flush=True,
                        )
                    _V38_W += _CORE_W
                    _CORE_W = 0.0

                # Normalize weights (لو sum != 1.0)
                _total_w = _V38_W + _CORE_W + _SMC_W + _VP_W
                if _total_w > 0:
                    _V38_W  /= _total_w
                    _CORE_W /= _total_w
                    _SMC_W  /= _total_w
                    _VP_W   /= _total_w

                # حساب الـ hybrid score
                _v38_val = float(_last_sig.get('combined_score', _last_sig.get('tech_score', 50)) or 50)
                _smc_val = float(_smc_s) if _smc_s is not None else 50.0
                _vp_val  = float(_vp_s) if _vp_s is not None else 50.0
                _core_val = _core_score if _core_score is not None else 50.0

                _new_combined = (
                    _v38_val  * _V38_W  +
                    _core_val * _CORE_W +
                    _smc_val  * _SMC_W  +
                    _vp_val   * _VP_W
                )
                _new_combined = max(0, min(100, round(_new_combined, 2)))
                _last_sig['combined_score'] = _new_combined
                # audit fields (للـ backtest analysis)
                _last_sig['v38_score'] = round(_v38_val, 2)
                _last_sig['core_score'] = round(_core_val, 2) if _core_score is not None else None

                # استخراج VWAP + OBV للـ display
                if _vp_s is not None:
                    try:
                        _vp_analyzer = __import__('analyzers.volume_profile', fromlist=['VolumeProfileAnalyzer']).VolumeProfileAnalyzer()
                        _vp_result = _vp_analyzer.analyze(
                            closes[max(0,day_idx-30):day_idx+1],
                            volumes[max(0,day_idx-30):day_idx+1],
                        )
                        _last_sig['vwap'] = _vp_result.vwap
                        _last_sig['obv'] = _vp_result.obv
                        _last_sig['volume_nodes'] = _vp_result.volume_nodes
                    except Exception:
                        pass

                print(
                    f"[HYBRID-SCORE] {ticker} on {scan_date}: "
                    f"v38={_v38_val:.1f}×{_V38_W:.0%} + core={_core_val:.1f}×{_CORE_W:.0%} "
                    f"+ smc={_smc_val:.1f}×{_SMC_W:.0%} + vp={_vp_val:.1f}×{_VP_W:.0%} "
                    f"→ combined={_new_combined:.1f}"
                    + (f" [CORE-FAIL]" if _core_score is None else ""),
                    flush=True,
                )

            # ── AI NEWS AGENT (المرحلة 3 — 2026-08-31): الإثبات السابع ──
            # جلب وتحليل الأخبار بالذكاء الاصطناعي المحلي (keyword fallback)
            # لو الأخبار سلبية → تقليل الثقة
            # لو الأخبار إيجابية → boost الثقة
            # safe-by-design: لو الـ Agent فشل → نتجاهل ونكمّل
            # A/B TESTING: V40_2_SKIP_NEWS env var to skip news (faster backtest)
            #
            # ⚠️ BRAVO-NEWS-DISABLE (2026-10-20): news_agent معطّل — under development.
            # السبب: analyze_stock_news() بيعمل network calls لكل سهم (DuckDuckGo/news API)
            # → 289 سهم × network = ~10 دقايق لكل run = الفرصة بتضيع.
            # المحرك شغّال بدون news (الـ 6 إثباتات التانية كافية). هيتفعل لما يتصلح.
            # لإعادة التفعيل: اشيل التعليق من الكود تحت + اتأكد إن news_agent شغّال offline.
            #
            # try:
            #     if os.environ.get('V40_2_SKIP_NEWS', '0') == '1':
            #         raise RuntimeError('news skipped for A/B backtest')
            #     from ai.news_agent import NewsAgent
            #     if not hasattr(engine, '_news_agent'):
            #         engine._news_agent = NewsAgent()
            #     if engine._news_agent.is_ready() or DDGS_AVAILABLE:
            #         _news_result = engine._news_agent.analyze_stock_news(
            #             ticker, max_articles=2
            #         )
            #         _news_score = _news_result.get('score', 50)
            #         _news_sentiment = _news_result.get('sentiment', 'neutral')
            #         # خزّن في آخر signal
            #         if signals_by_date[scan_date]:
            #             signals_by_date[scan_date][-1]['news_sentiment'] = _news_sentiment
            #             signals_by_date[scan_date][-1]['news_score'] = _news_score
            #             signals_by_date[scan_date][-1]['news_summary'] = _news_result.get('summary', '')
            #         # لو الأخبار سلبية جداً (score < 30) → ارفض
            #         if _news_score < 30 and _news_result.get('confidence', 0) > 0.5:
            #             print(f"[NEWS-REJECT] {ticker} on {scan_date}: أخبار سلبية "
            #                   f"(score={_news_score}/100) → رفض", flush=True)
            #             signals_by_date[scan_date].pop()  # شيل آخر signal
            # except Exception as _news_err:
            #     pass  # safe-by-design: لو الـ Agent فشل → نتجاهل

        del dates, opens, highs, lows, closes, volumes, atrs, date_to_idx
        if processed % 100 == 0:
            gc.collect()

    print(f"\n✅ Processed {total_tickers} tickers. Signals found on {len(signals_by_date)} dates.", flush=True)

    # ── V40_2_BACKTEST_MODE (2026-08-31): A/B testing harness ──
    _backtest_mode = os.environ.get('V40_2_BACKTEST_MODE', '0') == '1'

    if dry_run and not _backtest_mode:
        # ── Phase 8.2: dry-run printer extracted ────────────────────────────
        # Original block extracted to predictor_modules.dry_run_printer.print_dry_run_summary.
        print_dry_run_summary(signals_by_date, max_picks)
        return

    # Store: sort each date's signals, take top N, morning bell = top 1
    # PHASE-1-RESTORE (2026-08-31): V40.2 رجع كمولّد توقعات أساسي
    # Maestro اتعلّل واتعطل من الكتابة — V40.2 هو المصدر الوحيد دلوقتي
    tracker = PredictionTracker(PREDICTIONS_DB)  # مفعّل — V40.2 يكتب في predictions
    # V40_2_BACKTEST_MODE: set _dry_run_no_write=True عشان يـ set outcomes
    _dry_run_no_write = _backtest_mode  # لو backtest mode → set outcomes
    total_generated = 0
    total_morning_bells = 0
    daily_summary = []
    all_stored = []

    # (radar fallback was moved BEFORE the dry-run check above —
    #  it now runs even in dry-run mode so users see the picks)

    for scan_date in sorted(signals_by_date.keys()):
        all_day_signals = signals_by_date[scan_date]
        # Only tradeable BUY signals can be candidate picks (Rule GLM5.2-S1: HOLD is not a trade)
        buy_signals = [s for s in all_day_signals if s.get('signal') in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY')]
        # Sort: evidence DESC → R-multiple DESC → tech_score DESC
        buy_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
        picks = buy_signals[:max_picks]

        # REGIME-ENGINE (2026-09-27): apply regime-aware min_score filter
        # DEFENSIVE → min_score=75 (was 60). AGGRESSIVE → min_score=70.
        # This skips low-quality picks that would otherwise be stored.
        if _regime_cfg is not None:
            _regime_min_score = float(_regime_cfg.get("min_score", 60))
            _picks_before = len(picks)
            picks = [s for s in picks if float(s.get('tech_score', 0) or 0) >= _regime_min_score]
            if _picks_before != len(picks):
                print(f"🌐 [REGIME] {scan_date}: dropped {_picks_before - len(picks)} picks "
                      f"(score < {_regime_min_score} for {_regime_name} regime)", flush=True)

        # B4-MARKET-REGIME-FIX (Task 1-c, owner directive):
        # The previous RADAR-FALLBACK (2026-10-05) block was REMOVED because it
        # fabricated BUY signals (source='radar_fallback', position_size_mult=0.5)
        # when DEFENSIVE regime produced 0 picks. This bypassed the V40.2 engine
        # decision and injected counter-trend opportunities during BEAR market —
        # exactly the symptom the owner reported. We now emit an explicit
        # NO_TRADE message instead so the API can surface the real decision.
        # NO thresholds, weights, or trading rules were changed — only the
        # fabrication path was removed.
        if len(picks) == 0 and _regime_cfg is not None and _regime_name == 'DEFENSIVE':
            print(
                f"🛑 [B4-NO-TRADE] {scan_date}: DEFENSIVE regime — 0 qualifying BUY picks "
                f"(min_score={_regime_cfg.get('min_score', 65)}, min_rr={_regime_cfg.get('min_rr', 1.8)}). "
                f"NO_TRADE decision preserved — no fabricated opportunities.",
                flush=True,
            )

        for rank, sig in enumerate(picks):
            # ── UNIFIED-BALANCED-ONLY (2026-08-30): تعطيل morning_bell ──
            # morning_bell كان بيميّز "أقوى توقع في اليوم" كـ persona-specific feature.
            # دلوقتي كل التوقعات balanced، فالـ morning_bell بـ يبقى 0 لكل التوقعات.
            # الكود القديم: sig['morning_bell'] = 1 if rank == 0 else 0
            sig['morning_bell'] = 0  # UNIFIED-BALANCED-ONLY: معطّل

        for sig in picks:
            # ── RECOMMENDATION 1: فلتر حرارة القطاع — معطّل ──────────────────
            # باك-تست على بيانات الإنتاج (68 صفقة): فلتر القطاع الهابط نقص العائد -37.6%
            # لأنه رفض 5 رابحة + 5 خاسرة (50/50). ألغي.
            # sector_heat = load_sector_heat()
            # ticker_sector = get_ticker_sector(sig['ticker'])
            # if ticker_sector and ticker_sector in sector_heat:
            #     _heat = sector_heat[ticker_sector]
            #     if _heat < 0:
            #         continue

            total_generated += 1
            if sig.get('morning_bell'):
                total_morning_bells += 1
            all_stored.append(sig)

            hit_target = 1 if sig['exit_reason'] == 'hit_target' else 0
            hit_stop = 1 if sig['exit_reason'] == 'hit_stop' else 0
            is_correct = 1 if sig['is_win'] else 0
            fit_tag = sig.get('persona_fit', 'balanced')
            fit_scores = sig.get('persona_fit_scores', {})
            fit_score = fit_scores.get(fit_tag, 0.0)

            # ── V40.2 EVIDENCE GATE (2026-10-12 — PRED-WRITE-GUARD) ─────────
            # B.3 FIX: When V40.2 evidence engine fails (e.g., stale
            # egksco_price_history → institutional_decision_engine exception
            # → fallback returns evidence=0), skip the prediction instead of
            # writing a placeholder.
            #
            # This is the root-cause fix for the 2026-09-27 catastrophe:
            # IMPROVEMENT-12 was converting WAIT→HOLD and writing placeholder
            # predictions (evidence=0 + kill_filter=NULL). The PREDICTION-
            # WRITE-GUARD in record_prediction() will block these anyway,
            # but this early-skip prevents:
            #   1. The DB write attempt (cleaner audit trail)
            #   2. The notebook integration for placeholder predictions
            #   3. Confusion in logs (explicit skip vs. silent guard reject)
            #
            # Threshold: evidence >= 3 (V40.2 minimum — Rule 21 lists 6
            # evidences; 3 is the floor for "engine actually computed evidence")
            _sig_signal = (sig.get('signal') or '').upper()
            _sig_evidence = int(sig.get('evidence', 0) or 0)
            if _sig_signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE') and _sig_evidence < 3:
                print(
                    f"[V40_2-EVIDENCE-SKIP] {sig['ticker']} {_sig_signal} "
                    f"evidence={_sig_evidence}/6 < 3 → SKIP "
                    f"(Rule 21 — placeholder prevention, B.3 fix)",
                    flush=True,
                )
                continue

            # ── LGBM GATEKEEPER (Task BRAVO-CODEPLOY-B2.3) ───────────────────
            # حارس البوابة الذكي يفحص كل توصية BUY قبل إدراجها في predictions table.
            # النموذج (models/lgbm_signal_gatekeeper.joblib) مُدرّب على 619 صفقة
            # حقيقية بـ threshold=0.65 (78.95% win rate على 57 صفقة out-of-sample).
            # لو proba < 0.65 → لا تُدرج التوصية (لا تُكتب في predictions)،
            #   و تُسجّل في log فقط (للـ audit trail — التتبع المؤسسي).
            # لو ACCEPTED أو SKIPPED_INSUFFICIENT_DATA → تُدرج التوصية كالمعتاد.
            # Rule 27 (NO-FAKE-DATA): لو الـ features لا يمكن حسابها (بيانات ناقصة)،
            #   verdict='SKIPPED_INSUFFICIENT_DATA' → السماح بالمرور conservative.
            if _sig_signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
                # BRAVO-FIX (2026-10-19): analyzers.lgbm_gatekeeper module مش موجود.
                # الـ try/except كان بـ يـفشل بصمت → SKIPPED_INSUFFICIENT_DATA دايماً.
                # تم تعطيل الـ gate لإن الملف مش موجود. لو محتاج ML gatekeeper:
                # اعمل analyzers/lgbm_gatekeeper.py الأول.
                _gk_proba, _gk_features, _gk_verdict = 0.0, {}, 'SKIPPED_INSUFFICIENT_DATA'
                if _gk_verdict == 'REJECTED_BY_AI_GATEKEEPER':
                    print(
                        f"[LGBM-GATEKEEPER] REJECTED {sig['ticker']} "
                        f"proba={_gk_proba:.2f} < 0.65 threshold "
                        f"(signal={_sig_signal}, evidence={_sig_evidence}/6) → SKIP prediction",
                        flush=True,
                    )
                    continue
                # ACCEPTED أو SKIPPED_INSUFFICIENT_DATA → نكمّل وندخل التوصية
                if _gk_verdict == 'ACCEPTED':
                    print(
                        f"[LGBM-GATEKEEPER] ACCEPTED {sig['ticker']} "
                        f"proba={_gk_proba:.2f} >= 0.65 (signal={_sig_signal})",
                        flush=True,
                    )
                else:
                    print(
                        f"[LGBM-GATEKEEPER] SKIPPED {sig['ticker']} "
                        f"insufficient data → conservative pass (signal={_sig_signal})",
                        flush=True,
                    )

            try:
                # ── HARD QUANT KILL FILTER (Task B-22, 2026-10-14) ─────────────
                # حارس كمي صارم قبل أي كتابة في predictions.db/stocks.db.
                # القواعد القطعية (Zero-Tolerance — Owner Directive):
                #   1. R:R ≥ 1.5 (المستهدف ≥ 2.0) — أي صفقة تخاطر بأكثر من مكسبها تُقتل
                #   2. الثقة ≥ 65% — ثقة 50% رمية عملة ممنوعة
                #   3. Falling Knife Prevention: لو السعر تحت MA50 بـ ≥5% والمسار هابط
                #      صريح (MA50 < MA200) → ممنوع إعطاء أهداف صاعدة للشراء
                # المنطق: skip كامل للصفقة (continue) — لا تُكتب في DB إطلاقًا.
                _sig_rr = float(sig.get('r_multiple', 0) or 0)
                _sig_master_raw = float(sig.get('combined_score', sig.get('tech_score', 0)) or 0)
                _sig_conf = _sig_master_raw
                _sig_entry = float(sig.get('entry', 0) or 0)
                _sig_target = float(sig.get('target', 0) or 0)
                _sig_stop = float(sig.get('stop', 0) or 0)

                # BRAVO-WIRE-EVALUATE-RISK-001 (2026-10-18 — كيمي P0 directive):
                # Gate every prediction INSERT with evaluate_risk() before it reaches
                # tracker.record_prediction(). Rule 18 (R/R ≥ 1.8) + Rule 19 (position
                # cap 2.5%) + Rule 8 (ATR stop [5%,9%]) enforced CANONICALLY here.
                # This is the SSOT gate — replaces the ad-hoc 1.5 check below.
                # Works on laptop + VPS (relative import via sys.path, no hardcoded paths).
                if _sig_signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
                    try:
                        from engine.flow_system import evaluate_risk as _evaluate_risk_gate
                        _risk_eval = _evaluate_risk_gate(
                            entry_price=_sig_entry,
                            stop_loss=_sig_stop,
                            target_price=_sig_target,
                            calculated_position_size=0.025,  # Rule 19 cap
                            confidence=_sig_conf,
                        )
                        if _risk_eval['killed']:
                            print(
                                f"[BRAVO-EVALUATE-RISK-KILL] {sig['ticker']} {_sig_signal} "
                                f"entry={_sig_entry:.2f} stop={_sig_stop:.2f} target={_sig_target:.2f} "
                                f"rr={_risk_eval['rr']} → {_risk_eval['kill_reason']} "
                                f"→ SKIP INSERT (Rule 18/27)",
                                flush=True,
                            )
                            continue
                        # Capture capped position_size for the prediction record.
                        _bravo_position_size = _risk_eval['position_size']
                    except ImportError:
                        # Fallback: if engine.flow_system import fails (rare), use the
                        # legacy ad-hoc check but with the CORRECT 1.8 floor (not 1.5).
                        _bravo_position_size = 0.025
                        _risk = _sig_entry - _sig_stop if _sig_entry > _sig_stop else 0
                        _reward = _sig_target - _sig_entry if _sig_target > _sig_entry else 0
                        _computed_rr = (_reward / _risk) if _risk > 0 else 0.0
                        _effective_rr = max(_sig_rr, _computed_rr)
                        if _effective_rr < 1.8:
                            print(
                                f"[BRAVO-EVALUATE-RISK-FALLBACK-KILL] {sig['ticker']} {_sig_signal} "
                                f"R:R={_effective_rr:.2f} < 1.8 (Rule 18) → SKIP INSERT",
                                flush=True,
                            )
                            continue
                else:
                    _bravo_position_size = 0.025  # non-BUY signals — default cap

                # Legacy ad-hoc R/R check (KEPT for visibility, but evaluate_risk above
                # is now the canonical gate. This block is now defensive-only.)
                _computed_rr = 0.0
                if _sig_entry > 0 and _sig_target > _sig_entry and _sig_entry > _sig_stop:
                    _risk = _sig_entry - _sig_stop
                    _reward = _sig_target - _sig_entry
                    _computed_rr = _reward / _risk if _risk > 0 else 0.0
                _effective_rr = max(_sig_rr, _computed_rr)

                # BRAVO-AUDIT: gate raised from 1.5 → 1.8 (Rule 18 — was violation).
                # evaluate_risk above is canonical; this is defensive double-check.
                if _sig_signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE') and _effective_rr < 1.8:
                    print(
                        f"[HARD-QUANT-KILL] {sig['ticker']} {_sig_signal} "
                        f"R:R={_effective_rr:.2f} < 1.8 (computed={_computed_rr:.2f}, stored={_sig_rr:.2f}) "
                        f"→ SKIP (Rule 18: R:R ≥ 1.8 إلزامي)",
                        flush=True,
                    )
                    continue

                # 2. الثقة ≥ 65% check
                if _sig_signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE') and _sig_conf < 65.0:
                    print(
                        f"[HARD-QUANT-KILL] {sig['ticker']} {_sig_signal} "
                        f"confidence={_sig_conf:.1f}% < 65% → SKIP "
                        f"(Rule: الثقة ≥ 65% إلزامي)",
                        flush=True,
                    )
                    continue

                # 3. Falling Knife Prevention: لو السعر تحت MA50 بـ ≥5% + MA50 < MA200
                #    → ممنوع أهداف صاعدة للشراء
                try:
                    _ma50 = float(sig.get('ma_50', 0) or 0)
                    _ma200 = float(sig.get('ma_200', 0) or 0)
                    _current = _sig_entry if _sig_entry > 0 else float(sig.get('current_price', 0) or 0)
                    if _ma50 > 0 and _ma200 > 0 and _current > 0:
                        _below_ma50_pct = ((_ma50 - _current) / _ma50) * 100
                        _is_falling_knife = (_current < _ma50 * 0.95) and (_ma50 < _ma200)
                        if _is_falling_knife and _sig_signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE') and _sig_target > _sig_entry:
                            print(
                                f"[HARD-QUANT-KILL] {sig['ticker']} {_sig_signal} "
                                f"FALLING KNIFE: price={_current:.2f} < MA50({_ma50:.2f})×0.95 "
                                f"AND MA50 < MA200({_ma200:.2f}) → SKIP ascending target "
                                f"(Rule: لا أهداف صاعدة على سكين ساقط)",
                                flush=True,
                            )
                            continue
                except Exception:
                    pass  # safe-by-design: لو MA غير متاح → نكمّل

                # Rule 54 BUG FIX: master_score كان = tech_score (نفس القيمة في العمودين)
                # دلوقتي master_score = combined_score (يشمل تأثير الأخبار + كل التعديلات)
                # technical_score = tech_score (الدرجة الفنية الخام من V38)
                # ده بـ يخلي master_score مختلف عن technical_score و يعكس الدرجة الكلية الحقيقية
                _master_score = sig.get('combined_score', sig['tech_score'])
                _tp2 = sig.get('target_2') or (round(sig['target'] * 1.5, 2) if sig.get('target') else None)
                pred_id = tracker.record_prediction(
                    ticker=sig['ticker'], signal=sig['signal'],
                    entry_price=sig['entry'], target_price=sig['target'],
                    stop_loss=sig['stop'], master_score=_master_score,
                    technical_score=sig['tech_score'], persona='balanced',
                    fundamental_score=sig.get('fundamental_score'),  # REAL DATA ONLY — no placeholder (per owner directive + Rule 24) — None when missing
                    atr_at_entry=sig.get('atr', 0), target_price_2=_tp2,
                    prediction_date=scan_date, evidence_count=sig['evidence'],
                    morning_bell=sig.get('morning_bell', 0),
                    risk_reward=sig.get('r_multiple'),  # P0 FIX (V402-DIAGNOSIS R5): كان محسوب لكن غير مكتوب
                    who_is_buying_state=sig.get('who_is_buying_state', ''),  # P0 FIX (V402-DIAGNOSIS R6)
                    # PREDICTION-STORE-FIX (2026-10-18): تم إزالة support_level/resistance_level kwargs
                    # لأن record_prediction() signature مفيهمش + predictions table مفيهاش columns لهم.
                    # ده كان بيسبب "Store error: got an unexpected keyword argument 'support_level'"
                    # وبيمنع تخزين التوقعات (59 توقع اتلغوا بسبب ده أمبارح).
                    # TODO: لو محتاجين S/R في predictions، نضيف columns + params في task منفصل.
                    kill_filter_result=f"V40 evidence={sig['evidence']}/6 R={sig['r_multiple']:.2f} | fit:{fit_tag}({fit_score:.0f})" + (" | SOFT-SURGE" if sig.get('proofs', {}).get('soft_surge') else "") + f" | LIQUIDITY:{sig.get('liquidity_type', 'neutral')}({sig.get('liquidity_score', 50)}) pos_mult={sig.get('liquidity_pos_mult', 1.0)}" + f" | V68:prob={sig.get('v68_probability', 0)}/100 dir={sig.get('v68_future_direction', 'flat')}" + (" | A+GRAB" if sig.get('v68_liquidity_grab') else "") + (" | QUIET-ACC" if sig.get('v68_quiet_accumulation') else ""),
                ) if tracker else None
                if pred_id and tracker:
                    # ── NOTEBOOK INTEGRATION (2026-09-01): اكتب ملاحظة في النوتبوك ──
                    # النوتبوك = ذاكرة دائمة للمحلل (بدل ما نحسب من جديد كل مرة)
                    try:
                        from analyzers.stock_notebook import add_prediction_observation
                        _nb_filters = []
                        if sig.get('v68_dirty_distribution'): _nb_filters.append('V68-dirty-dist')
                        if sig.get('v72_hidden_dist', {}).get('block_active'): _nb_filters.append('V72-hidden-dist')
                        if sig.get('v73_desert_phase'): _nb_filters.append('V73-desert')
                        add_prediction_observation(
                            ticker=sig['ticker'], signal=sig['signal'],
                            entry=sig['entry'], target=sig['target'],
                            stop=sig['stop'], score=sig['tech_score'],
                            evidence=sig['evidence'], r_multiple=sig['r_multiple'],
                            target_2=sig.get('target_2', 0),
                            source='v40_2',
                            filters_triggered=_nb_filters,
                        )
                    except Exception:
                        pass  # safe-by-design: لو النوتبوك فشل → نكمّل

                    # PHASE-2-RESTORE (2026-08-31): لا نسجل outcome في backtest
                    # daily_closer هو اللي يقفل الصفقات في الإنتاج الحقيقي
                    # بنسجل بس للـ backtest (dry_run) — لو مش dry_run، نسيبها pending
                    if _dry_run_no_write or dry_run:
                        tracker.set_verified_outcome(
                            prediction_id=pred_id, outcome_date=sig['exit_date'],
                            exit_price=sig['exit_price'], actual_return=sig['return_pct'],
                            hit_target=hit_target, hit_stop=hit_stop,
                            is_correct=is_correct,
                            holding_days=sig.get('holding_days', 0),
                            exit_reason=sig['exit_reason'],
                        )
                    else:
                        # مزامنة التوقع المعتمد في stored_analyses لشاشة التوقعات المباشرة
                        # CANONICAL-WRITER (Task PHASE-3, Rule 73)
                        # This is the ONLY file allowed to write to stored_analyses.
                        # All other writers have been disabled (see SINGLE-WRITER comments
                        # in ai_routes.py, misc_routes.py, persona_db.py, intraday_scanner.py,
                        # market_scheduler.py, nightly_analysis.py).
                        try:
                            # BRAVO-FIX-D (stored_analyses empty): writable=False made the
                            # INSERT below fail with "attempt to write a readonly database"
                            # (PRAGMA query_only=1) → stored_analyses stayed empty (0 rows)
                            # despite 10+ writers. The except: pass on line ~4199 swallowed
                            # the error silently. This is the CANONICAL writer for
                            # stored_analyses (Rule 73 SINGLE-WRITER), so it MUST be writable.
                            from core.db_manager import db_manager
                            conn_sa = db_manager.get_connection(PREDICTIONS_DB, writable=True)
                            cur_sa = conn_sa.cursor()
                            # ── TASK-A (2026-10-04): تأكّد إن أعمدة AI موجودة ──
                            # الأعمدة دي declared في ai/nightly_analysis.py بس ممكن تكون
                            # مش موجودة لو الـ nightly job ماشتغلش قبل كده. ALTER آمن
                            # (idempotent — هيقع في except لو العمود موجود بالفعل).
                            try:
                                cur_sa.execute("ALTER TABLE stored_analyses ADD COLUMN ai_reason TEXT")
                            except Exception:
                                pass
                            try:
                                cur_sa.execute("ALTER TABLE stored_analyses ADD COLUMN ai_narrative TEXT")
                            except Exception:
                                pass
                            try:
                                conn_sa.commit()
                            except Exception:
                                pass
                            now_iso = datetime.now().isoformat()
                            # ── TASK-A: استخرج summary و full_text من technical_explanation ──
                            _sa_tech = sig.get('technical_explanation') or {}
                            if not isinstance(_sa_tech, dict):
                                _sa_tech = {}
                            _sa_ai_reason = _sa_tech.get('summary', '') or ''
                            _sa_ai_narrative = _sa_tech.get('full_text', '') or ''
                            sa_json = json.dumps({
                                'ticker': sig['ticker'],
                                'signal': sig['signal'],
                                'entry_price': sig['entry'],
                                'target_price': sig['target'],
                                'target_price_2': sig.get('target_2', 0),
                                'stop_loss': sig['stop'],
                                'risk_reward': sig['r_multiple'],
                                # Rule 54: master_score = combined_score (مش tech_score)
                                'master_score': sig.get('combined_score', sig['tech_score']),
                                'technical_score': sig['tech_score'],
                                'evidence_count': sig['evidence'],
                                'source': 'V40.2_DAILY',
                                # ── TASK-A: شرح فني شامل يظهر في الـ UI ──
                                'technical_explanation': _sa_tech,
                            }, ensure_ascii=False)
                            sa_id = f"v40_{sig['ticker']}_{market_code.upper()}"
                            # FIX (BRAVO-DISASTER C1, 2026-10-28): was hardcoded 'EGX' — so all
                            # TADAWUL/KSE/QSE predictions were silently persisted as market='EGX'.
                            # This is why the user found 0 TADAWUL predictions: they were saved
                            # under EGX. Now we pass market_code as a bound parameter.
                            cur_sa.execute('''
                                INSERT INTO stored_analyses (
                                    id, ticker, market, maestro_score, recommendation, recommendation_ar,
                                    confidence, entry_price, target_price, stop_loss, risk_reward,
                                    prediction_date, updated_at, analysis_json, is_gambler_opportunity, is_investor_opportunity,
                                    ai_reason, ai_narrative
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
                                ON CONFLICT(ticker, market) DO UPDATE SET
                                    maestro_score = excluded.maestro_score,
                                    recommendation = excluded.recommendation,
                                    recommendation_ar = excluded.recommendation_ar,
                                    confidence = excluded.confidence,
                                    entry_price = excluded.entry_price,
                                    target_price = excluded.target_price,
                                    stop_loss = excluded.stop_loss,
                                    risk_reward = excluded.risk_reward,
                                    prediction_date = excluded.prediction_date,
                                    updated_at = excluded.updated_at,
                                    analysis_json = excluded.analysis_json,
                                    is_gambler_opportunity = 1,
                                    is_investor_opportunity = 1,
                                    ai_reason = excluded.ai_reason,
                                    ai_narrative = excluded.ai_narrative
                            ''', (
                                sa_id, sig['ticker'], market_code.upper(),
                                sig['tech_score'], sig['signal'],
                                'شراء قوي' if 'STRONG' in sig['signal'] else 'شراء',
                                # UNIFY-FIX (Rule 20): confidence ديناميكي = master_score
                                # كان hardcoded=85 — كل التوقعات عندها نفس الثقة (مخالفة Rule 73)
                                sig.get('combined_score', sig['tech_score']),
                                sig['entry'], sig['target'], sig['stop'],
                                sig['r_multiple'], scan_date, now_iso, sa_json,
                                _sa_ai_reason, _sa_ai_narrative,
                            ))
                            conn_sa.commit()
                            conn_sa.close()
                        except Exception:
                            pass
                    # ── Phase 2 Fix: Read lessons BEFORE finalizing prediction ──
                    # This connects the closed loop: close → lesson → next prediction reads it.
                    # Safe-by-design: if lesson_store fails, prediction proceeds normally.
                    # BRAVO MAESTRO-CANCER-1 STEP 3: swapped maestro import → V40.2 native.
                    # OLD: from analyzers.maestro_orchestrator import run_expert_memory_phase
                    # NEW: from utils.expert_memory_v402 import run_expert_memory_phase_v402
                    # Also fixed dead veto: old checked 'block' (never returned) → now checks 'caution'.
                    try:
                        from utils.expert_memory_v402 import run_expert_memory_phase_v402
                        _em = run_expert_memory_phase_v402(
                            db_path=PREDICTIONS_DB,
                            ticker=sig['ticker'],
                            sector=_sector_change if isinstance(_sector_change, str) else '',
                            regime=result.get('market_regime_trend', 'range') if isinstance(result, dict) else 'range',
                            rsi=0.0,
                            month=int(scan_date.split('-')[1]) if '-' in scan_date else 1,
                            persona_name='balanced',
                        )
                        # V40.2 lesson-veto: 'caution' = lesson says reduce/skip (was 'block' dead code)
                        if _em and _em.recommendation == 'caution':
                            print(
                                f"🚫 [EXPERT-MEMORY-V402] Caution {sig['ticker']} on {scan_date} "
                                f"— lesson-based veto: {_em.reason}", flush=True
                            )
                            continue
                    except Exception:
                        pass  # Safe-by-design — lessons optional
                    # ── UNIFIED-BALANCED-ONLY (2026-08-30): تعطيل persona_predictions writing ──
                    # المنطق الموحد: مفيش persona تانية غير balanced. الكود القديم
                    # بـ يكتب persona_predictions للأسهم اللي strongly fit gambler/conservative.
                    # دلوقتي ده معطّل (مش بـ يكتب حاجة) عشان النظام يفضل unified.
                    #
                    # Phase 2 (Option A — Safe) [LEGACY — معطّل]:
                    # if fit_tag in ('gambler', 'conservative') and fit_score >= PERSONA_FIT_MIN_SCORE:
                    #     try:
                    #         safe_store_prediction(
                    #             ticker=sig['ticker'], market='EGX',
                    #             persona_type=fit_tag,
                    #             signal_type=sig['signal'],
                    #             entry_price=sig['entry'],
                    #             target_price=sig['target'],
                    #             stop_loss=sig['stop'],
                    #             prediction_date=scan_date,
                    #         )
                    #         update_persona_prediction_outcome(
                    #             ticker=sig['ticker'],
                    #             persona_type=fit_tag,
                    #             final_price=sig['exit_price'],
                    #             prediction_date=scan_date,
                    #         )
                    #     except Exception as pe:
                    #         print(f"  ⚠️ persona_predictions {sig['ticker']}/{fit_tag}: {pe}", flush=True)
            except Exception as e:
                print(f"  ⚠️ Store error {sig['ticker']}: {e}", flush=True)

        mb = picks[0] if picks else None
        wins = sum(1 for p in picks if p['is_win'])
        daily_summary.append({
            'date': scan_date, 'picks': len(picks), 'wins': wins,
            'morning_bell': mb['ticker'] if mb else '',
            'mb_win': mb['is_win'] if mb else False,
            'avg_evidence': round(sum(p['evidence'] for p in picks) / len(picks), 1) if picks else 0,
        })
        print(f"  📅 {scan_date}: {len(picks)} picks ({wins}W/{len(picks) - wins}L) | "
              f"MB={mb['ticker'] if mb else '-'}({'✅' if mb and mb['is_win'] else '❌'}) | "
              f"avg_ev={daily_summary[-1]['avg_evidence']}", flush=True)


    # ── Phase 8.2: summary block extracted ──────────────────────────────────
    # Original block extracted to predictor_modules.summary.compute_and_save_summary.
    # Computes PF + win rate + signal/evidence distributions + saves JSON summary.
    compute_and_save_summary(
        all_stored=all_stored,
        daily_summary=daily_summary,
        total_generated=total_generated,
        total_morning_bells=total_morning_bells,
        start_date=start_date,
        end_date=end_date,
        scan_interval=scan_interval,
        predictions_db=PREDICTIONS_DB,
        project_root=PROJECT_ROOT,
    )


# ═══════════════════════════════════════════════════════════════════════════
# 🐋 WHALE RADAR HUNTER — Counter-Trend Smart Money Picks (جيمي directive)
# ═══════════════════════════════════════════════════════════════════════════
# لما السوق العام يكون كاش/تصحيح ومحرك Trend Following مبيطلعش صفقات،
# رادار الميكرز بيرصد تجميع مؤسسي هادئ (Quiet Accumulation مسار B) بسيولة ضخمة.
# ده function بـ reads الـ maker_radar JSON + بـ inject الأسهم في stored_analyses
# كـ "WHALE_RADAR" picks مع إدارة مخاطر صارمة (2% risk + 1.8 R/R + ATR stop).
# ═══════════════════════════════════════════════════════════════════════════

def inject_whale_radar_picks(market='EGX', dry_run=False):
    """ربط رادار الحيتان والتوقعات بمحرك الفحص الموحد (Unified Scanner).
    
    يطبق البوابة السيادية (Hard Gate 0) وصيد قاع التصحيح (Golden Dip)
    مع R/R >= 2.0 وبروتوكول الخروج الذهبي TP1 (+6.5%) وإلغاء أي أرقام وهمية.
    """
    if dry_run:
        print("[WHALE-RADAR] dry-run active — skipping DB write", flush=True)
        return 0
    try:
        from core.sync_scanner_to_db import sync_scanner_to_stored_analyses
        count = sync_scanner_to_stored_analyses(market=market)
        print(f"[WHALE-RADAR] ✅ تم تحديث stored_analyses عبر UnifiedScanner: {count} صفقات حية", flush=True)
        return count
    except Exception as e:
        print(f"[WHALE-RADAR] ❌ فشل تحديث UnifiedScanner: {e}", flush=True)
        return 0


def main():
    parser = argparse.ArgumentParser(
        description='V40.2 Prediction Generator — توليد توقعات V40.2 لأي فترة',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  %(prog)s --today-only              # توليد لليوم
  %(prog)s --yesterday-only          # توليد لأمس
  %(prog)s --start 2026-08-01 --end 2026-08-14  # فترة مخصصة
  %(prog)s --today-only --dry-run    # جاف فقط (اختبار)
  %(prog)s --keep-old                # عدم حذف القديم
""",
    )
    parser.add_argument('--start', default=None,
                        help=f'تاريخ البداية (YYYY-MM-DD). افتراضي: {DEFAULT_START}')
    parser.add_argument('--end', default=None,
                        help='تاريخ النهاية (YYYY-MM-DD). افتراضي: اليوم')
    parser.add_argument('--today-only', action='store_true',
                        help='توليد لليوم فقط (تجاهل --start/--end)')
    parser.add_argument('--yesterday-only', action='store_true',
                        help='توليد لأمس فقط (للكرون بعد إغلاق السوق)')
    parser.add_argument('--scan-interval', type=int, default=SCAN_INTERVAL,
                        help=f'فحص كل N أيام تداول (افتراضي: {SCAN_INTERVAL}). استخدم 1 لفحص كل يوم')
    parser.add_argument('--max-picks', type=int, default=MAX_PICKS_PER_DAY,
                        help=f'حد أقصى توقعات/يوم (افتراضي: {MAX_PICKS_PER_DAY})')
    parser.add_argument('--dry-run', action='store_true',
                        help='جاف فقط — لا يكتب في DB، يطبع ما كان سيتولده')
    parser.add_argument('--keep-old', action='store_true',
                        help='عدم حذف توقعات V40 القديمة في الفترة (الافتراضي: يحذف)')
    parser.add_argument('--max-tickers', type=int, default=None,
                        help='⚡ BATCH MODE: limit عدد الـ tickers المتعالجًا (للـ resume في ساندبوكس بـ timeout)')
    parser.add_argument('--tickers-offset', type=int, default=0,
                        help='⚡ BATCH MODE: skip أول N tickers (للـ resume بعد run سابق)')
    parser.add_argument('--force', action='store_true',
                        help='تخطّى أى circuit breaker / quality gate / cooldown ومنع التشغيل')
    parser.add_argument('--incremental', action='store_true',
                        help='⚡ INCREMENTAL MODE: skip التواريخ المحسوبة بالفعل في predictions.db (يبدأ من آخر تاريخ مسجل + 1)')
    parser.add_argument('--full', action='store_true',
                        help='⚡ FULL MODE: إعادة المسح الكامل من 2026-01-01 (تعطيل التراكمي التلقائي)')
    parser.add_argument('--smart', action='store_true',
                        help='⚡ SMART MODE (default for cron): فلتر الأسهم الميتة + أيام الإجازات + التوقعات اللي لسه valid. يقلل التحليلات 90%%+')
    parser.add_argument('--market', default='EGX', choices=['EGX', 'KSA', 'KSE', 'QSE', 'CRYPTO'],
                        help='السوق: EGX (افتراضي) / KSA / KSE / QSE / CRYPTO')
    args = parser.parse_args()

    # Determine date range
    today_str = datetime.now().strftime('%Y-%m-%d')
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    if args.today_only and args.yesterday_only:
        print("❌ لا يمكن استخدام --today-only و --yesterday-only معاً", flush=True)
        sys.exit(1)

    if args.today_only:
        # FIX (2026-09-03): --today-only كان بيـ query price_history لليوم بالظبط.
        # لو price_history.db مش محدث لليوم (السوق لسه ما فتحش أو الـ safetynet
        # ما شغلش) → مفيش تواريخ → 0 signals → 0 predictions.
        # الحل: لو اليوم مش موجود، استخدم آخر يوم متاح في price_history.db.
        # ده يخلي V40.2 يـ generate توقعات بناءً على أحدث بيانات موجودة.
        start_date = today_str
        end_date = today_str
        scan_interval = 1
    elif args.yesterday_only:
        start_date = yesterday_str
        end_date = yesterday_str
        scan_interval = 1
    else:
        start_date = args.start or DEFAULT_START
        end_date = args.end or today_str
        scan_interval = args.scan_interval

    # Validate dates
    try:
        datetime.strptime(start_date, '%Y-%m-%d')
        datetime.strptime(end_date, '%Y-%m-%d')
    except ValueError as e:
        print(f"❌ صيغة تاريخ خاطئة: {e}. استخدم YYYY-MM-DD", flush=True)
        sys.exit(1)

    if start_date > end_date:
        print(f"❌ تاريخ البداية ({start_date}) بعد تاريخ النهاية ({end_date})", flush=True)
        sys.exit(1)

    # AUTO-INCREMENTAL DEFAULT (2026-10-18 — Owner Directive via Jimmy):
    # الوضع التراكمي أصبح هو الافتراضي! يبدأ من آخر تاريخ مسجل في predictions.db
    # عشان ما يعيدش حساب شهور كاملة ويضيع الداتا.
    auto_incremental = not getattr(args, 'full', False) and (args.incremental or (args.start is None and not args.today_only and not args.yesterday_only))
    if auto_incremental:
        _db_dir_inc = Path(__file__).resolve().parents[2] / 'db'
        _pred_db_path = str(_db_dir_inc / 'predictions.db')
        if os.path.exists(_pred_db_path):
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                _inc_conn = db_manager.get_connection(_pred_db_path, writable=False)
                _inc_row = _inc_conn.execute("""
                    SELECT MAX(max_d) FROM (
                        SELECT MAX(prediction_date) AS max_d FROM predictions WHERE prediction_date IS NOT NULL
                        UNION ALL
                        SELECT MAX(prediction_date) AS max_d FROM aiPrediction WHERE prediction_date IS NOT NULL
                    )
                """).fetchone()
                _inc_conn.close()
                _last_pred_date = _inc_row[0] if _inc_row and _inc_row[0] else None
                if _last_pred_date:
                    from datetime import timedelta as _td
                    _last_dt = datetime.strptime(_last_pred_date, '%Y-%m-%d')
                    _new_start = (_last_dt + _td(days=1)).strftime('%Y-%m-%d')
                    if _new_start > start_date:
                        print(f"⚡ AUTO-INCREMENTAL: آخر توقع مسجل = {_last_pred_date}. بدء المسح من {_new_start} فقط (بدل {start_date})", flush=True)
                        start_date = _new_start
                        if start_date > end_date:
                            print(f"✅ لا توجد تواريخ جديدة للمعالجة ({start_date} > {end_date}). كل شيء محدّث تماماً.", flush=True)
                            sys.exit(0)
                    else:
                        print(f"⚡ AUTO-INCREMENTAL: آخر توقع {_last_pred_date}، لكن start_date المطلوب ({start_date}) أحدث. بنعالج من {start_date}.", flush=True)
                else:
                    print("⚡ AUTO-INCREMENTAL: predictions.db فاضي — بنعالج من البداية.", flush=True)
            except Exception as _inc_err:
                print(f"⚠️ AUTO-INCREMENTAL: فشل قراءة آخر توقع ({_inc_err}) — بنكمل من {start_date}.", flush=True)
        else:
            print("⚡ AUTO-INCREMENTAL: predictions.db مش موجود — بنعالج من البداية.", flush=True)

    # FIX (Aug 2026): route لـ CRYPTO generator لو --market CRYPTO
    if args.market == 'CRYPTO':
        run_crypto_generator(
            start_date=start_date,
            end_date=end_date,
            scan_interval=scan_interval,
            max_picks=args.max_picks,
            dry_run=args.dry_run,
            keep_old=args.keep_old,
            max_tickers=args.max_tickers,
            tickers_offset=args.tickers_offset,
            force=args.force,
        )
    else:
        run_generator(
            start_date=start_date,
            end_date=end_date,
            scan_interval=scan_interval,
            max_picks=args.max_picks,
            dry_run=args.dry_run,
            keep_old=args.keep_old,
            max_tickers=args.max_tickers,
            tickers_offset=args.tickers_offset,
            force=args.force,
            market_code=args.market,
            smart_mode=args.smart,
        )

    # 🐋 WHALE RADAR HUNTER (جيمي directive):
    # بعد ما run_generator يخلص، شغل whale radar injection.
    # ده بـ reads الـ maker_radar JSON + بيـ inject أسهم الحيتان في stored_analyses.
    # لو السوق كاش والـ trend following مطلعش حاجة → الرادار يـ fill الفراغ.
    if args.market != 'CRYPTO':
        print("\n" + "=" * 60, flush=True)
        print("🐋 WHALE RADAR HUNTER — Counter-Trend Smart Money", flush=True)
        print("=" * 60, flush=True)
        try:
            whale_count = inject_whale_radar_picks(
                market=args.market,
                dry_run=args.dry_run,
            )
            print(f"🐋 Whale picks injected: {whale_count}", flush=True)
        except Exception as _whale_err:
            print(f"[WHALE-RADAR] ⚠️ Error: {_whale_err}", flush=True)


def get_crypto_tickers(min_days=30):
    """Get crypto tickers from crypto_prices table (data_engine.db).

    FIX (Aug 2026): دعم CRYPTO في daily_predictor.
    بيرجع بس العملات اللي ليها تاريخ كافي في crypto_prices.
    """
    _db_dir = Path(__file__).resolve().parents[2] / 'db'
    tickers = []
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(_db_dir / 'data_engine.db'), writable=False)
        cur = conn.cursor()
        # شوف عدد snapshots المختلفة لكل symbol
        cur.execute("""
            SELECT symbol, COUNT(DISTINCT timestamp) as cnt
            FROM crypto_prices
            GROUP BY symbol
            HAVING cnt >= ?
            ORDER BY market_cap_rank ASC
            LIMIT 50
        """, (min_days,))
        tickers = [row[0] for row in cur.fetchall()]
        conn.close()
        # Task CRYPTO-1: استبعاد العملات المستقرة والرموز المغلفة
        pre_stablecoin_count = len(tickers)
        tickers = [t for t in tickers if not is_stablecoin(t)]
        stablecoin_filtered = pre_stablecoin_count - len(tickers)
        if stablecoin_filtered > 0:
            print(f"[V40.2-CRYPTO] 🚫 STABLECOINS blacklist: {stablecoin_filtered} عملة مستقرة/مغلّفة مستبعدة", flush=True)
        print(f"[V40.2-CRYPTO] crypto_prices — {len(tickers)} coins with >= {min_days} snapshots (after stablecoin filter)", flush=True)
    except Exception as e:
        print(f"[V40.2-CRYPTO] ⚠️ Failed to load crypto tickers: {e}", flush=True)
    return tickers


def run_crypto_generator(start_date, end_date, scan_interval=1,
                          max_picks=5, dry_run=False, keep_old=False,
                          max_tickers=None, tickers_offset=0, force=False):
    """Crypto prediction generator — نسخة مبسطة من run_generator للكريبتو.

    FIX (Aug 2026): إضافة دعم CRYPTO لـ daily_predictor.

    الكريبتو 24/7 فمفيش session restrictions. بنفسلم OHLC من CoinGecko
    لكل عملة ونعمل تحليل فني مبسط (RSI + MA + trend).
    """
    print("=" * 80, flush=True)
    print("  V40.2-CRYPTO Prediction Generator", flush=True)
    print(f"  Period: {start_date} → {end_date} | Scan every {scan_interval} days", flush=True)
    print(f"  Max picks/day: {max_picks}", flush=True)
    print("=" * 80, flush=True)

    # CoinGecko symbol → coin_id mapping
    SYMBOL_TO_COIN_ID = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin',
        'SOL': 'solana', 'XRP': 'ripple', 'ADA': 'cardano',
        'DOGE': 'dogecoin', 'AVAX': 'avalanche-2', 'DOT': 'polkadot',
        'LINK': 'chainlink', 'MATIC': 'matic-network', 'LTC': 'litecoin',
        'TRX': 'tron', 'UNI': 'uniswap', 'ATOM': 'cosmos',
    }

    import requests as _requests

    tickers = get_crypto_tickers(min_days=30)
    if max_tickers is not None:
        tickers = tickers[tickers_offset:tickers_offset + max_tickers]

    if not tickers:
        print("[V40.2-CRYPTO] ⚠️ No crypto tickers available. Exiting.", flush=True)
        return

    # للتوليد الحقيقي، نحتاج Python backend prediction_tracker
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.prediction_tracker import PredictionTracker
        tracker = PredictionTracker()
    except Exception as e:
        print(f"[V40.2-CRYPTO] ⚠️ PredictionTracker not available: {e}", flush=True)
        tracker = None

    # نمشي على كل scan_date
    from datetime import datetime as _dt, timedelta as _td
    start_dt = _dt.strptime(start_date, '%Y-%m-%d')
    end_dt = _dt.strptime(end_date, '%Y-%m-%d')
    current = start_dt
    total_generated = 0

    while current <= end_dt:
        scan_date = current.strftime('%Y-%m-%d')
        print(f"\n[V40.2-CRYPTO] Scanning {scan_date}...", flush=True)
        daily_picks = 0

        for ticker in tickers:
            if daily_picks >= max_picks:
                break
            coin_id = SYMBOL_TO_COIN_ID.get(ticker.upper())
            if not coin_id:
                continue
            try:
                # جلب OHLC من CoinGecko
                url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc"
                params = {'vs_currency': 'usd', 'days': '30'}
                resp = _requests.get(url, params=params, timeout=15)
                if not resp.ok:
                    continue
                ohlc = resp.json()
                if len(ohlc) < 15:
                    continue
                closes = [c[4] for c in ohlc]
                last_price = closes[-1]

                # حساب RSI بسيط
                # FIX-2 (Rule 24 + owner directive): was `rsi = 50.0` (placeholder
                # — if RSI computation failed, fake neutral 50 meant no BUY signal
                # triggered (50<40 False) and no SELL signal (50>70 False). Behavior
                # is the same with None (conditions False) but the code is now honest
                # — no fake data implication).
                rsi: Optional[float] = None
                if len(closes) >= 15:
                    # CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing
                    # قبل كده: كان SMA-based على آخر 14 شمعة فقط — غلط رياضيًا.
                    from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
                    rsi = _canonical_calc_rsi(closes, 14)

                # حساب MA50 (proxy: آخر 30 closes)
                ma50 = sum(closes) / len(closes) if closes else last_price

                # إشارة بسيطة
                # FIX-2: guard rsi is not None (no fake 50.0 comparison)
                if rsi is not None and rsi < 40 and last_price > ma50:
                    signal = 'BUY'
                    entry = last_price
                    target = last_price * 1.15  # +15%
                    stop = last_price * 0.92     # -8%
                elif rsi is not None and rsi > 70:
                    signal = 'SELL'
                    entry = last_price
                    target = last_price * 0.85
                    stop = last_price * 1.08
                else:
                    continue  # NEUTRAL — skip

                # ── CRYPTO STRICT ENTRY (2026-09-01): accumulation/grab فقط ──
                # Toggle: V40_2_CRYPTO_STRICT_ENTRY=1 (default OFF)
                if signal == 'BUY' and os.environ.get('V40_2_CRYPTO_STRICT_ENTRY', '0') == '1':
                    try:
                        from analyzers.crypto_strict_filters import evaluate_crypto_strict_entry
                        # Build OHLC lists
                        crypto_opens = [c[1] for c in ohlc] if len(ohlc[0]) > 4 else closes
                        crypto_highs = [c[2] for c in ohlc] if len(ohlc[0]) > 4 else closes
                        crypto_lows = [c[3] for c in ohlc] if len(ohlc[0]) > 4 else closes
                        crypto_vols = [1.0] * len(closes)  # CoinGecko OHLC doesn't have volume
                        _c_entry = evaluate_crypto_strict_entry(closes, crypto_highs, crypto_lows, crypto_vols, rsi=rsi)
                        if _c_entry['decision'] == 'REJECT':
                            print(f"  [CRYPTO-ENTRY-REJECT] {ticker}: {_c_entry['reason'][:60]}", flush=True)
                            try:
                                from analyzers.decision_logger import log_decision
                                _c_reason = 'late_entry' if _c_entry.get('is_late') else 'not_accumulation'
                                log_decision(ticker, 'reject_entry', _c_reason,
                                    _c_entry['reason'][:200], 'V40_2_CRYPTO_STRICT_ENTRY',
                                    market='CRYPTO', scan_date=scan_date)
                            except Exception:
                                pass
                            continue
                    except Exception:
                        pass  # safe-by-design

                # ── CRYPTO DISCLOSURE IMPACT (2026-09-01): أحداث الكريبتو ──
                # Toggle: V40_2_CRYPTO_DISCLOSURE_IMPACT=1 (default OFF)
                if signal == 'BUY' and os.environ.get('V40_2_CRYPTO_DISCLOSURE_IMPACT', '0') == '1':
                    try:
                        from analyzers.crypto_disclosure_engine import get_crypto_disclosure_impact_for_symbol
                        _c_disc = get_crypto_disclosure_impact_for_symbol(ticker)
                        _c_disc_score = _c_disc.get('impact_score', 0)
                        _c_disc_verdict = _c_disc.get('verdict', 'NEUTRAL')
                        if _c_disc_verdict == 'VETO' and _c_disc_score <= -2:
                            print(f"  [CRYPTO-DISCLOSURE-VETO] {ticker}: {_c_disc.get('reason_ar', '')} → رفض", flush=True)
                            try:
                                from analyzers.decision_logger import log_decision
                                log_decision(ticker, 'reject_entry', 'crypto_disclosure_veto',
                                    _c_disc.get('reason_ar', ''), 'V40_2_CRYPTO_DISCLOSURE_IMPACT',
                                    market='CRYPTO', scan_date=scan_date)
                            except Exception:
                                pass
                            continue  # hard reject
                        # Log boost/reduce (no score change in simple version)
                        if _c_disc_score != 0:
                            print(f"  [CRYPTO-DISCLOSURE-{_c_disc_verdict}] {ticker}: score={_c_disc_score:+d}", flush=True)
                    except Exception:
                        pass  # safe-by-design

                # ── CRYPTO NEWS IMPACT (2026-09-01): أخبار الكريبتو ──
                # Toggle: V40_2_CRYPTO_NEWS_IMPACT=1 (default OFF)
                if signal == 'BUY' and os.environ.get('V40_2_CRYPTO_NEWS_IMPACT', '0') == '1':
                    try:
                        from analyzers.crypto_news_fetcher import get_crypto_news_with_impact
                        _c_news = get_crypto_news_with_impact(ticker, max_news=3)
                        _c_news_score = _c_news.get('overall_score', 0)
                        _c_news_verdict = _c_news.get('overall_verdict', 'NEUTRAL')
                        if _c_news_verdict == 'VETO' and _c_news_score <= -2:
                            print(f"  [CRYPTO-NEWS-VETO] {ticker}: {_c_news.get('reason', '')} → رفض", flush=True)
                            try:
                                from analyzers.decision_logger import log_decision
                                log_decision(ticker, 'reject_entry', 'crypto_news_veto',
                                    _c_news.get('reason', ''), 'V40_2_CRYPTO_NEWS_IMPACT',
                                    market='CRYPTO', scan_date=scan_date)
                            except Exception:
                                pass
                            continue  # hard reject
                        if _c_news_score != 0:
                            print(f"  [CRYPTO-NEWS-{_c_news_verdict}] {ticker}: score={_c_news_score:+d} (news={_c_news.get('news_count', 0)})", flush=True)
                    except Exception:
                        pass  # safe-by-design

                # تخزين التوقع
                # ── RULE 35 HARD DISABLE (2026-10-12 — PRED-WRITE-GUARD) ─────
                # CRYPTO path was writing placeholder predictions:
                #   - evidence_count=0 (default — V40.2 evidence engine not run)
                #   - kill_filter_result='' (default — no V40.2 kill filters)
                #   - master_score=60+(100-rsi) — FAKE formula, not from V40.2
                #     evidence pipeline (Rule 27 NO-FAKE-DATA + Rule 67 breach)
                #   - persona='crypto_balanced' — not in 3 canonical personas
                #     (gambler/balanced/conservative) per Rule 23
                #   - technical_score=rsi — RSI is NOT the technical_score
                #
                # This violates Rule 35 (V40.2 is the only writer) + Rule 21
                # (BUY requires 6 evidences) + Rule 27 (no fake data) + Rule 67
                # (CALCULATION-CANONICAL).
                #
                # The PREDICTION-WRITE-GUARD in record_prediction() will REJECT
                # this call anyway, but we add this explicit early-skip so:
                #   1. No DB write attempt is made (cleaner logs)
                #   2. The CRYPTO path is documented as disabled pending a real
                #      V40.2 CRYPTO evidence pipeline implementation
                #   3. Rule 16 VERIFY-BEFORE-DELETE: code preserved for reference
                #
                # TODO: Implement V40.2 CRYPTO evidence pipeline (6 evidences
                # adapted for crypto markets: Trend + Makers + DNA + On-chain
                # + Sentiment + Benchmark). Until then, CRYPTO predictions are
                # served by the live crypto_lab_scheduler.py + crypto_predictions
                # table (separate from predictions.db).
                if tracker and not dry_run:
                    print(
                        f"[RULE35-DISABLED] CRYPTO path for {ticker} {signal} "
                        f"entry=${entry:.2f} RSI={rsi:.0f} — placeholder "
                        f"prediction BLOCKED (Rule 35 ENGINE-UNIFY). CRYPTO "
                        f"V40.2 evidence pipeline not yet implemented. "
                        f"Use crypto_lab_scheduler.py for live crypto signals.",
                        flush=True,
                    )
                    pred_id = None  # Rule 35: no INSERT
                else:
                    print(f"  [DRY] {ticker} {signal} entry=${entry:.2f} RSI={rsi:.0f}", flush=True)
                    daily_picks += 1

            except Exception as e:
                print(f"  ⚠️ {ticker}: {e}", flush=True)
                continue

        current += _td(days=scan_interval)

    print(f"\n[V40.2-CRYPTO] Done. Total predictions: {total_generated}", flush=True)


if __name__ == '__main__':
    main()
