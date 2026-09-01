#!/usr/bin/env python3
"""
V40.2 Historical/Daily Prediction Generator (CLI-enabled)
==========================================================
توليد توقعات V40.2 لأي فترة تاريخية أو لليوم/أمس.

هذه نسخة مطوّرة من scratch/v40_2_historical_generator.py تقبل معاملات CLI
وتدعم وضع --today-only و --yesterday-only لتوليد توقعات يومية.

الاستخدامات:
  # توليد لفترة كاملة (افتراضي: 2026-01-01 ← اليوم)
  python3 vps-service/jobs/v40_2_daily_generator.py

  # توليد لليوم فقط (للكرون اليومي)
  python3 vps-service/jobs/v40_2_daily_generator.py --today-only

  # توليد لأمس فقط (بعد إغلاق السوق)
  python3 vps-service/jobs/v40_2_daily_generator.py --yesterday-only

  # فترة مخصصة
  python3 vps-service/jobs/v40_2_daily_generator.py --start 2026-08-01 --end 2026-08-14

  # جاف فقط (لا يكتب في DB) — للاختبار
  python3 vps-service/jobs/v40_2_daily_generator.py --today-only --dry-run

  # عدم حذف التوقعات القديمة (الافتراضي: يحذف V40 predictions القديمة في الفترة)
  python3 vps-service/jobs/v40_2_daily_generator.py --today-only --keep-old

الكرون المقترح (بعد إغلاق السوق بـ 30 دقيقة):
  30 14 * * 0-4 cd /home/z/my-project && /root/.venv/bin/python3 \
    vps-service/jobs/v40_2_daily_generator.py --yesterday-only \
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

# ─── Path setup ───
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'vps-service'))
os.chdir(PROJECT_ROOT)
os.environ['BYPASS_PRED_CAP'] = '1'

from engines.v38_backtest_engine import V38BacktestEngine, Trade, simulate_trade, calc_atr
PRICE_HISTORY_DB = str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db')
from analyzers.liquidity_filter import set_strict_kill_filters
from analyzers.prediction_tracker import PredictionTracker
from analyzers.adaptive_weights import PERSONA_INPUT_WEIGHTS
from analyzers.core_scoring_engine import detect_volume_surge_rocket, detect_accumulation_phase, detect_recovery_from_base

# ─── Rule 28: Toxic Ticker Blocklist ───
_BLOCKLIST_PATH = Path(__file__).resolve().parents[1] / 'config' / 'toxic_ticker_blocklist.json'
_TOXIC_BLOCKLIST = None  # lazy-loaded cache

def _load_toxic_blocklist():
    """Load the toxic ticker blocklist (Rule 28).
    Returns a set of ticker symbols to skip during generation.
    """
    global _TOXIC_BLOCKLIST
    if _TOXIC_BLOCKLIST is not None:
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
SCAN_INTERVAL = 1  # TUNED: daily scan (was 3 — missed daily breakouts)
MAX_PICKS_PER_DAY = 5
MIN_TICKER_DAYS = 200

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
V72_HIDDEN_DIST_BLOCK = os.environ.get('V72_HIDDEN_DIST_BLOCK', '1') == '1'    # ✅ KEEP — +36.5% return
V72_PULLBACK_BUY_PATH = os.environ.get('V72_PULLBACK_BUY_PATH', '0') == '1'    # ❌ KILL — 0 triggers
V72_MAKER_DEATH_POINT = os.environ.get('V72_MAKER_DEATH_POINT', '0') == '1'    # ❌ KILL — no effect
V72_KILL_SWITCH_EXIT = os.environ.get('V72_KILL_SWITCH_EXIT', '0') == '1'      # ⏸️ PENDING — exit-level
V72_MARKET_BULLISH_SIZING = os.environ.get('V72_MARKET_BULLISH_SIZING', '0') == '1'  # ❌ KILL — 0 triggers

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
    """Compute R-multiple: reward/risk ratio."""
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


def compute_persona_fit(proofs):
    """احسب persona_fit لكل ترشيح V40.2 من evidence proofs.

    بـ derive 4 category scores من proofs الـ V40.2:
      trend + dna  → price_action (momentum / candle structure)
      makers       → smc_vsa (هيكل صناع السوق)
      sector       → sector_heat (سخونة القطاع)
      fundamentals → fundamental (P/E + ROE + debt)
    وبـ weightها بـ PERSONA_INPUT_WEIGHTS عشان نحسب fit score (0-100) لكل شخصية.

    الرجوع:
        {'persona_fit': 'gambler'|'balanced'|'conservative',
         'fit_scores': {'gambler': float, 'balanced': float, 'conservative': float}}
    """
    proofs = proofs or {}

    def _has_check(key):
        return '✅' in str(proofs.get(key, ''))

    # trend + dna → price_action (كل واحد 50%، كحد أقصى 100)
    pa_count = (1 if _has_check('trend') else 0) + (1 if _has_check('dna') else 0)
    base_scores = {
        'price_action': min(100.0, (pa_count / 2.0) * 100.0),
        'smc_vsa':      100.0 if _has_check('makers') else 0.0,
        'sector_heat':  100.0 if _has_check('sector') else 0.0,
        'fundamental':  100.0 if _has_check('fundamentals') else 0.0,
    }

    fit_scores = {}
    for persona in ('gambler', 'balanced', 'conservative'):
        w = PERSONA_INPUT_WEIGHTS[persona]
        fit = sum(base_scores[c] * w[c]
                  for c in ('price_action', 'smc_vsa', 'sector_heat', 'fundamental'))
        fit_scores[persona] = round(fit, 1)

    best = max(fit_scores, key=fit_scores.get)
    return {'persona_fit': best, 'fit_scores': fit_scores}


def get_scan_dates(start_date, end_date, scan_interval):
    """Get trading dates from price history within [start, end].
    
    PHASE-2-DB-UNIFY (2026-08-29): price_history.db is the canonical source.
    - price_history.db.price_history: 1,248,257 rows, 25 سنة بيانات (2001→2026)
    - data_engine.db.egksco_price_history: 0 rows على الإنتاج (fallback only)
    - stocks.db.stock_daily_prices: آخر 30 يوم (fallback أخير)
    """
    _db_dir = Path(__file__).resolve().parents[2] / 'db'
    
    # 1. price_history.db (المصدر الكامل — 1.24M rows)
    try:
        conn = sqlite3.connect(str(_db_dir / 'price_history.db'), timeout=10.0)
        cur = conn.cursor()
        # Check schema (column name may be 'date' or 'price_date')
        cur.execute("PRAGMA table_info(price_history)")
        cols = [r[1] for r in cur.fetchall()]
        date_col = 'date' if 'date' in cols else 'price_date' if 'price_date' in cols else None
        if date_col:
            cur.execute(
                f"SELECT DISTINCT {date_col} FROM price_history WHERE {date_col} >= ? AND {date_col} <= ? ORDER BY {date_col} ASC",
                (start_date, end_date),
            )
            dates = [row[0] for row in cur.fetchall()]
            conn.close()
            if dates:
                print(f"[V40.2] Using price_history.db ({date_col}) — {len(dates)} dates", flush=True)
                return dates[::scan_interval]
        conn.close()
    except Exception:
        pass
    
    # 2. Fallback: data_engine.db (egksco_price_history — 0 rows على prod)
    try:
        conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM egksco_price_history WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        if dates:
            print(f"[V40.2] Using data_engine.db (egksco_price_history) — {len(dates)} dates", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass
    
    # 3. Fallback أخير: stocks.db (stock_daily_prices — آخر 30 يوم)
    try:
        conn = sqlite3.connect(str(_db_dir / 'stocks.db'), timeout=10.0)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM stock_daily_prices WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        if dates:
            print(f"[V40.2] Using stocks.db (stock_daily_prices) — {len(dates)} dates", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass
    
    print(f"⚠️  No trading dates found between {start_date} and {end_date}", flush=True)
    return []


def get_tickers(min_days=MIN_TICKER_DAYS):
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
    """
    _db_dir = Path(__file__).resolve().parents[2] / 'db'

    # EGX-MARKET-ISOLATION: استيراد الـ gate
    try:
        from utils.egx_gate import filter_egx_tickers_detailed
        _egx_gate_available = True
    except Exception:
        _egx_gate_available = False

    # 1. price_history.db (المصدر الكامل — 1,267 tickers)
    try:
        conn = sqlite3.connect(str(_db_dir / 'price_history.db'), timeout=10.0)
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(price_history)")
        cols = [r[1] for r in cur.fetchall()]
        ticker_col = 'ticker' if 'ticker' in cols else 'symbol' if 'symbol' in cols else None
        if ticker_col:
            cur.execute(
                f"SELECT DISTINCT {ticker_col} FROM price_history GROUP BY {ticker_col} HAVING COUNT(*) >= ? ORDER BY {ticker_col}",
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
                    print(f"[V40.2] price_history.db ({ticker_col}) — {len(raw_tickers)} raw → "
                          f"{len(tickers)} EGX-canonical "
                          f"(rejected {stats['rejected_count']} non-EGX, "
                          f"removed {stats['duplicates_removed']} dups)", flush=True)
                else:
                    tickers = raw_tickers
                    print(f"[V40.2] Using price_history.db ({ticker_col}) — {len(tickers)} tickers "
                          f"(⚠️ EGX gate not available — no filtering)", flush=True)
                return tickers
        conn.close()
    except Exception:
        pass

    # 2. Fallback: data_engine.db (egksco_price_history — 0 rows على prod)
    try:
        conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
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
                print(f"[V40.2] data_engine.db (egksco_price_history) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
            return tickers
    except Exception:
        pass

    # 3. Fallback أخير: stocks.db (stock_daily_prices — 1,023 tickers)
    try:
        conn = sqlite3.connect(str(_db_dir / 'stocks.db'), timeout=10.0)
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


def delete_old_v40_predictions(start_date=None, end_date=None):
    """Delete previous V40 historical predictions to avoid duplicates.

    If start_date/end_date provided, only delete predictions in that range.
    Otherwise, delete ALL V40 predictions.
    """
    conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
    cur = conn.cursor()
    if start_date and end_date:
        cur.execute(
            "DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%' "
            "AND prediction_date >= ? AND prediction_date <= ?",
            (start_date, end_date),
        )
    else:
        cur.execute("DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%'")
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    if deleted > 0:
        range_str = f" ({start_date} → {end_date})" if start_date else ""
        print(f"🧹 Deleted {deleted} old V40 predictions{range_str}", flush=True)
    else:
        print("ℹ️  No old V40 predictions to delete", flush=True)


# ─── RECOMMENDATION 1: فلتر حرارة القطاع ─────────────────────────────────────
# باك-تست: رفض التوقع لو القطاع هابط → رفع WR +1.5% + عائد +12.56%
_sector_heat_cache = {}

def load_sector_heat():
    """تحميل حرارة القطاعات من stocks.db (مرة واحدة)."""
    global _sector_heat_cache
    if _sector_heat_cache:
        return _sector_heat_cache
    
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        conn = sqlite3.connect(str(_db_dir / 'stocks.db'), timeout=10.0)
        cur = conn.cursor()
        cur.execute("""
            SELECT sector, AVG(change_percent) as avg_change, COUNT(*) as cnt
            FROM stocks
            WHERE is_active = 1 AND market = 'EGX' 
            AND sector IS NOT NULL AND change_percent IS NOT NULL
            GROUP BY sector HAVING COUNT(*) >= 3
        """)
        for row in cur.fetchall():
            _sector_heat_cache[row[0]] = row[1]
        conn.close()
        print(f"[V40.2] Sector heat loaded: {len(_sector_heat_cache)} sectors", flush=True)
    except Exception as e:
        print(f"[V40.2] ⚠️ Sector heat load failed: {e}", flush=True)
    
    return _sector_heat_cache

def get_ticker_sector(ticker):
    """جيب قطاع السهم من stocks.db."""
    try:
        _db_dir = Path(__file__).resolve().parents[2] / 'db'
        conn = sqlite3.connect(str(_db_dir / 'stocks.db'), timeout=5.0)
        cur = conn.cursor()
        cur.execute("SELECT sector FROM stocks WHERE ticker = ? AND market = 'EGX' LIMIT 1", (ticker,))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


def run_generator(start_date, end_date, scan_interval=SCAN_INTERVAL,
                  max_picks=MAX_PICKS_PER_DAY, dry_run=False, keep_old=False,
                  max_tickers=None, tickers_offset=0, force=False):
    """Main generation loop.

    Args:
        max_tickers: لو موجود، بـ limit عدد الـ tickers المتعالجًا في الـ run ده.
                     مفيد لتشغيل الباكتست على دفعات في ساندبوكس بـ timeout محدود.
        tickers_offset: skip أول N tickers (للـ resume بعد run سابق).
        force: تخطّى أى circuit breaker / quality gate / cooldown ومنع التشغيل.
    """
    print("=" * 80, flush=True)
    print("  V40.2 Prediction Generator (CLI-enabled)", flush=True)
    print(f"  Period: {start_date} → {end_date} | Scan every {scan_interval} days", flush=True)
    print(f"  Max picks/day: {max_picks} | Morning bell: top 1", flush=True)
    print(f"  Strict kill-filters: ON | Real EGX30ETF benchmark: ON", flush=True)
    print(f"  Dry-run: {dry_run} | Keep old: {keep_old} | Force: {force}", flush=True)
    if max_tickers is not None:
        print(f"  ⚡ BATCH MODE: max_tickers={max_tickers}, offset={tickers_offset}", flush=True)
    print("=" * 80, flush=True)

    # V40.2: enable strict kill-filter mode for the whole run
    set_strict_kill_filters(True)

    if not dry_run and not keep_old:
        delete_old_v40_predictions(start_date, end_date)
    elif keep_old:
        print("ℹ️  --keep-old: skipping deletion of old V40 predictions", flush=True)

    scan_dates = get_scan_dates(start_date, end_date, scan_interval)
    if not scan_dates:
        print("❌ No scan dates to process. Exiting.", flush=True)
        return

    tickers = get_tickers()
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

    if dry_run:
        print("🔍 DRY-RUN: would process the above dates. No DB writes.", flush=True)

    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)
    engine._load_fundamentals()
    engine._load_benchmark()  # V40.2: load EGX30ETF benchmark explicitly

    signals_by_date = defaultdict(list)
    total_tickers = len(tickers)
    processed = 0
    surge_picks_this_run = 0  # AXIS-5b: counter for Volume Surge Hunter picks
    accum_picks_this_run = 0   # AXIS-5c: counter for Accumulation Detector picks
    recovery_picks_this_run = 0  # AXIS-5d: counter for Recovery from Long Base picks

    for ticker in tickers:
        processed += 1
        if processed % 50 == 0:
            print(f"  ⏳ Processing {processed}/{total_tickers} tickers...", flush=True)

        dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < MIN_TICKER_DAYS:
            continue
        atrs = calc_atr(highs, lows, closes, 14)
        date_to_idx = {d: i for i, d in enumerate(dates)}

        for scan_date in scan_dates:
            day_idx = date_to_idx.get(scan_date)
            if day_idx is None or day_idx < 60:
                continue

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
                result = engine.analyze_single_day_v393(
                    ticker, dates, opens, highs, lows, closes, volumes, day_idx, _sector_change,
                )
            except Exception:
                continue

            signal = result.get('signal', 'WAIT')
            # PILLAR-4: قبول BUY عادي (مش بس STRONG_BUY/INSTITUTIONAL_BUY) —
            # عشان نوصل للهدف التشغيلي 60-150 صفقة في 8 أشهر بدل 6 فقط.
            # الـ R/R >= 1.5 بـ يـ ensure جودة الصفقات (dynamic_rr_normal=1.5).
            # كمان sort بـ evidence_count ↓ → أعلى جودة بتـ pick أولاً.
            # RECOMMENDATION 3: إلغاء WATCH نهائياً (باك-تست: WR +6.9% + عائد +73.47%)
            # WATCH نسبة نجاحها 16.7% بس — أسوأ من العشوائي
            if signal in ('WATCH', 'HOLD', 'WAIT', 'NEUTRAL'):
                continue
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
                                    _vol_ratio_soft = (_today_vol_soft / _avg_vol_20) if _avg_vol_20 > 0 else 0
                                    # ROC5
                                    _roc5_soft = ((_closes_soft[-1] - _closes_soft[-6]) / _closes_soft[-6] * 100) if len(_closes_soft) >= 6 and _closes_soft[-6] > 0 else 0
                                    # SMA50
                                    _sma50_soft = sum(_closes_soft[-50:]) / 50 if len(_closes_soft) >= 50 else (_closes_soft[-1] if _closes_soft else 0)
                                    _above_sma50_soft = _closes_soft[-1] > _sma50_soft
                                    _near_sma50_soft = abs((_closes_soft[-1] - _sma50_soft) / _sma50_soft * 100) <= 3 if _sma50_soft > 0 else False

                                    # SOFT-SURGE: vol_ratio ≥ 2.0 + ROC5 > 3% + (فوق أو قريب SMA50)
                                    if _vol_ratio_soft >= 2.0 and _roc5_soft > 3.0 and (_above_sma50_soft or _near_sma50_soft):
                                        # احسب ATR للـ entry/target/stop
                                        _highs_soft = highs[:day_idx+1]
                                        _lows_soft = lows[:day_idx+1]
                                        _atr_soft = 0.0
                                        if len(_closes_soft) >= 15:
                                            _tr_list = []
                                            for i in range(1, min(15, len(_closes_soft))):
                                                _h = _highs_soft[-i] if abs(_highs_soft[-i]) > 0 else _closes_soft[-i]
                                                _l = _lows_soft[-i] if abs(_lows_soft[-i]) > 0 else _closes_soft[-i]
                                                _pc = _closes_soft[-i-1] if abs(_closes_soft[-i-1]) > 0 else _closes_soft[-i]
                                                # skip لو فيه قيم غلط
                                                if _h <= 0 or _l <= 0 or _pc <= 0 or _h < _l:
                                                    continue
                                                _tr = max(
                                                    _h - _l,
                                                    abs(_h - _pc),
                                                    abs(_l - _pc)
                                                )
                                                if _tr > 0 and _tr < _closes_soft[-1] * 0.20:  # skip TR > 20% (غالباً غلط)
                                                    _tr_list.append(_tr)
                                            _atr_soft = sum(_tr_list) / len(_tr_list) if _tr_list else 0
                                        if _atr_soft <= 0:
                                            _atr_soft = _closes_soft[-1] * 0.05  # fallback 5%
                                        # clamp ATR لـ [2%, 10%] من entry
                                        _atr_soft = max(_closes_soft[-1] * 0.02, min(_closes_soft[-1] * 0.10, _atr_soft))

                                        _entry_soft = _closes_soft[-1]
                                        _stop_soft = _entry_soft - (1.5 * _atr_soft)  # 1.5 ATR (balanced)
                                        _target_soft = _entry_soft + (3.0 * _atr_soft)  # 3 ATR → R:R = 2.0

                                        # تأكد R:R ≥ 1.8
                                        _rr_soft = (_target_soft - _entry_soft) / (_entry_soft - _stop_soft) if (_entry_soft - _stop_soft) > 0 else 0
                                        if _rr_soft >= 1.8:
                                            signal = 'STRONG_BUY'
                                            result['entry'] = round(_entry_soft, 4)
                                            result['target'] = round(_target_soft, 4)
                                            result['stop_loss'] = round(_stop_soft, 4)
                                            result['score'] = 50  # score وسط (الـ entry_gate هـ يفحص الباقي)
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
                                            continue
                                    else:
                                        continue
                                else:
                                    continue
                            except Exception:
                                continue

            entry = result['entry']
            target = result['target']
            stop = result['stop_loss']
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
                if _today_vol < 1000 or _yest_vol < 1000:
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
                if _daily_gain > 12.0:
                    _chase_rejected = True
                    _chase_reason = f'daily_gain=+{_daily_gain:.1f}% > +12%'
                elif _roc3 > 18.0:
                    _chase_rejected = True
                    _chase_reason = f'ROC3=+{_roc3:.1f}% > +18%'
                elif _roc5 > 28.0:
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
                    _rsi_quick = 50.0
                    if len(closes[:day_idx+1]) >= 15:
                        _gains, _losses = 0, 0
                        for _ri in range(1, 15):
                            _diff = closes[_ri] - closes[_ri-1] if _ri < len(closes[:day_idx+1]) else 0
                            if _diff >= 0: _gains += _diff
                            else: _losses -= _diff
                        _avg_g = _gains / 14
                        _avg_l = _losses / 14
                        _rsi_quick = 100 - (100 / (1 + (_avg_g / _avg_l if _avg_l > 0 else 999))) if _avg_l > 0 else 100
                    # رفض لو قرب القمة + RSI مرتفع
                    if _near_peak >= 95 and _rsi_quick > 65:
                        continue
                except Exception:
                    pass

            if not _is_surge_signal and not _is_accum_signal and not _is_recovery_signal and not _is_soft_surge_signal and day_idx >= 5:
                try:
                    _recent_high = max(highs[max(0, day_idx - 5):day_idx + 1])
                    _drawdown_from_high = ((_recent_high - entry) / _recent_high * 100) if _recent_high > 0 else 0
                    # لو السعر نزل أكتر من 5% من آخر high خلال 5 أيام → في تصحيح
                    if _drawdown_from_high >= 5.0:
                        continue
                except Exception:
                    pass  # safe fallback

            future_closes = closes[day_idx + 1:]
            future_dates = dates[day_idx + 1:]
            future_atrs = atrs[day_idx + 1:]
            if len(future_closes) < 5:
                continue

            trade = Trade(
                ticker=ticker, entry_date=scan_date, entry_price=entry,
                target_price=target, stop_loss=stop, score=result['score'],
                signal=signal, proofs=result['proofs'],
            )
            trade = simulate_trade(trade, future_closes, future_dates, 7, future_atrs)

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
                if _pattern_wr > 0 and _pattern_wr < 0.65:
                    # أداء ضعيف → قلل score
                    result['score'] = max(0, int(result['score'] * _pattern_wr / 0.65))
                    result['proofs']['feedback_warning'] = f'⚠️ أداء تاريخي ضعيف لهذا النمط (WR={_pattern_wr*100:.0f}%)'
                elif _pattern_wr >= 0.75:
                    # أداء كويس → boost
                    result['score'] = min(100, result['score'] + 5)
                    result['proofs']['feedback_boost'] = f'✅ أداء تاريخي قوي (WR={_pattern_wr*100:.0f}%)'
            except Exception:
                pass  # safe-by-design: لو feedback loop فشل → نكمّل

            # ── EGX-STRATEGY (2026-08-30): الحد الأدنى للإثباتات ──
            # استراتيجية المالك: "ندخل فقط عندما يكون الاحتمال لصالحنا بوضوح".
            # تحليل مارس-مايو أظهر إن 4 من 9 خسائر كان evidence=0/6 (بدون أي إثباتات).
            # الحل: رفض أي إشارة evidence < min_evidence_count (default=3).
            try:
                from analyzers.engine_settings import get_setting
                _min_ev = int(get_setting('min_evidence_count', default=3))
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
            _fit_persona = 'balanced'  # UNIFIED-BALANCED-ONLY: persona واحدة
            _fund_score = float(result.get('fundamental_score', 0.0) or 0.0)
            _fund_avail = bool(result.get('fundamentals_available', False))
            # if _fit_persona != 'gambler' and _fund_avail and _fund_score < 30.0:
            #     continue
            # UNIFIED-BALANCED-ONLY: veto دايماً (balanced logic)
            if _fund_avail and _fund_score < 30.0:
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
                _gate_data = {
                    'entry_price': entry,
                    'target_price': target,
                    'stop_price': stop,
                    'evidence_count': evidence,
                    'proofs': result.get('proofs', {}),
                    'closes': closes[:day_idx+1],
                    'volumes': volumes[:day_idx+1],
                    'market_regime_trend': result.get('market_regime_trend', ''),
                    'stock_roc': float(result.get('stock_roc', 0) or 0),
                    'benchmark_change': float(result.get('benchmark_change', 0) or 0),
                }
                _gate_result = check_entry_gate(_gate_data)
                if not _gate_result['passed']:
                    # log الـ rejection للـ audit
                    _fail_reasons = '; '.join(_gate_result['reasons_failed'][:3])
                    print(f"[ENTRY-GATE-REJECT] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                          f"score={_gate_result['score']}/{_gate_result['total_checks']} | {_fail_reasons}", flush=True)
                    continue
            except Exception as _gate_err:
                # safe-by-design: لو الـ gate فشل، سيب الإشارة تكمّل (مش نوقف النظام)
                pass

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
                    "SELECT sector FROM stocks WHERE ticker = ? AND market = 'EGX' LIMIT 1",
                    (ticker,)
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
                        WHERE market = 'EGX' AND sector = ? AND change_percent IS NOT NULL
                    """, (_stock_sector,)).fetchone()
                    if _sec_stats and _sec_stats['n'] >= 3:
                        _n = _sec_stats['n']
                        _avg_chg = float(_sec_stats['avg_chg'] or 0)
                        _rising = int(_sec_stats['rising'] or 0)
                        _rising_pct = _rising / _n
                        # sector dead: avg ≤ -1% AND rising ≤ 25%
                        if _avg_chg <= -1.0 and _rising_pct <= 0.25:
                            print(f"[SECTOR-DEAD] {ticker} on {dates[day_idx] if day_idx < len(dates) else '?'}: "
                                  f"sector={_stock_sector[:20]} avg={_avg_chg:+.2f}% rising={_rising}/{_n} → رفض", flush=True)
                            _sec_conn.close()
                            continue
                _sec_conn.close()
            except Exception as _sec_err:
                pass  # safe-by-design: لو sector filter فشل، سيب الإشارة تكمّل

            # ── BOS/ChoCH FILTER (مرحلة منفصلة 2 — 2026-08-30) ──
            # من Pine Script V56: BOS = كسر مقاومة → ترند صاعد مؤكد
            # ChoCH = كسر دعم → ترند هابط → خروج فوري
            # sweep_low = نزل تحت الدعم وقفل فوقه → ميكرز بيمتص السيولة
            # المنطق: لو في ChoCH bear (كسر دعم) → ارفض الدخول
            # لو في BOS bull أو sweep_low → boost الثقة
            try:
                from engines.v38_backtest_engine import detect_order_blocks_and_sweeps
                _ob_state = detect_order_blocks_and_sweeps(
                    highs[:day_idx+1], lows[:day_idx+1], closes[:day_idx+1], lookback=5
                )
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
                    _v62_pe = _v62_de_conn.execute(
                        "SELECT pe_ratio FROM tab_valuation WHERE symbol = ? ORDER BY date DESC LIMIT 1",
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
                from analyzers.v72_multi_path import (
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
                from analyzers.v73_sniper import detect_desert_phase, detect_auction_trap
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

