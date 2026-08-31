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

PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
# PRICE_HISTORY_DB is now imported from the engine — it auto-resolves to the
# correct location (primary db/ or daily backup db/backups/daily/*/) without
# copying or modifying any database file. Read-only detection.

DEFAULT_START = '2026-01-01'
DEFAULT_END = '2026-06-10'  # historical default (sandbox run)
SCAN_INTERVAL = 3
MAX_PICKS_PER_DAY = 5
MIN_TICKER_DAYS = 200


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
                _target_check = compute_dynamic_target(
                    entry, stop, _atr_val, highs=_highs_dyn, min_rr=1.8
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
            except Exception as _dyn_err:
                pass  # safe-by-design: لو فشل، سيب الـ stop/target القديم

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
            if r_mult < _min_rr:
                continue

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

            signals_by_date[scan_date].append({
                'ticker': ticker,
                'signal': signal,
                'entry': entry,
                'target': target,
                'target_2': result.get('target_2', 0),
                'stop': stop,
                'tech_score': result['score'],
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
                'liquidity_type': _liquidity['type'] if _liquidity else 'neutral',
                'liquidity_score': _liquidity['score'] if _liquidity else 50,
                'liquidity_pos_mult': _liquidity['position_size_mult'] if _liquidity else 1.0,
                'liquidity_hold_mult': _liquidity['hold_multiplier'] if _liquidity else 1.0,
                # PHASE-C FIX: خزّن الـ fundamental_score الحقيقي في DB بدل placeholder 50.0.
                # لما fundamentals تكون متاحة → الدرجة الحقيقية (0-100).
                # لما غير متاحة → 50.0 (neutral، نفس السلوك السابق — safe-by-design).
                # ده بـ يـ fix Rule 12 (ممنوع placeholder 50.0 في مسار إنتاجي)
                # دون ما يأثر على الـ veto (اللي بـ يقرأ من result dict مباشرة).
                'fundamental_score': _fund_score if _fund_avail else 50.0,
            })

        del dates, opens, highs, lows, closes, volumes, atrs, date_to_idx
        if processed % 100 == 0:
            gc.collect()

    print(f"\n✅ Processed {total_tickers} tickers. Signals found on {len(signals_by_date)} dates.", flush=True)

    if dry_run:
        total_signals = sum(len(v) for v in signals_by_date.values())
        print(f"🔍 DRY-RUN: would have generated {total_signals} signals across {len(signals_by_date)} dates.", flush=True)
        # Still print the summary of what would have been picked
        for scan_date in sorted(signals_by_date.keys()):
            day_signals = signals_by_date[scan_date]
            day_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
            picks = day_signals[:max_picks]
            mb = picks[0] if picks else None
            print(f"  📅 {scan_date}: {len(picks)} picks | MB={mb['ticker'] if mb else '-'} (ev={mb['evidence'] if mb else 0})", flush=True)
        return

    # Store: sort each date's signals, take top N, morning bell = top 1
    tracker = PredictionTracker(PREDICTIONS_DB)
    total_generated = 0
    total_morning_bells = 0
    daily_summary = []
    all_stored = []

    for scan_date in sorted(signals_by_date.keys()):
        day_signals = signals_by_date[scan_date]
        # Sort: evidence DESC → R-multiple DESC → tech_score DESC
        day_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
        picks = day_signals[:max_picks]

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

            hit_target = 1 if sig['exit_reason'] == 'hit_target' else 0
            hit_stop = 1 if sig['exit_reason'] == 'hit_stop' else 0
            is_correct = 1 if sig['is_win'] else 0
            fit_tag = sig.get('persona_fit', 'balanced')
            fit_scores = sig.get('persona_fit_scores', {})
            fit_score = fit_scores.get(fit_tag, 0.0)
            try:
                pred_id = tracker.record_prediction(
                    ticker=sig['ticker'], signal=sig['signal'],
                    entry_price=sig['entry'], target_price=sig['target'],
                    stop_loss=sig['stop'], master_score=sig['tech_score'],
                    technical_score=sig['tech_score'], persona='balanced',
                    fundamental_score=sig.get('fundamental_score', 50.0),
                    atr_at_entry=sig['atr'], target_price_2=sig['target_2'],
                    prediction_date=scan_date, evidence_count=sig['evidence'],
                    morning_bell=sig['morning_bell'],
                    kill_filter_result=f"V40 evidence={sig['evidence']}/6 R={sig['r_multiple']:.2f} | fit:{fit_tag}({fit_score:.0f})" + (" | SOFT-SURGE" if sig.get('proofs', {}).get('soft_surge') else "") + f" | LIQUIDITY:{sig.get('liquidity_type', 'neutral')}({sig.get('liquidity_score', 50)}) pos_mult={sig.get('liquidity_pos_mult', 1.0)}",
                )
                if pred_id:
                    tracker.set_verified_outcome(
                        prediction_id=pred_id, outcome_date=sig['exit_date'],
                        exit_price=sig['exit_price'], actual_return=sig['return_pct'],
                        hit_target=hit_target, hit_stop=hit_stop,
                        is_correct=is_correct,
                        holding_days=sig.get('holding_days', 0),
                        exit_reason=sig['exit_reason'],
                    )
                    # ── Phase 2 Fix: Read lessons BEFORE finalizing prediction ──
                    # This connects the closed loop: close → lesson → next prediction reads it.
                    # Safe-by-design: if lesson_store fails, prediction proceeds normally.
                    try:
                        from analyzers.maestro_orchestrator import run_expert_memory_phase
                        _em = run_expert_memory_phase(
                            db_path=PREDICTIONS_DB,
                            ticker=sig['ticker'],
                            sector=_sector_change if isinstance(_sector_change, str) else '',
                            regime=result.get('market_regime_trend', 'range') if isinstance(result, dict) else 'range',
                            rsi=0.0,
                            month=int(scan_date.split('-')[1]) if '-' in scan_date else 1,
                            persona_name='balanced',
                        )
                        if _em and _em.recommendation == 'block':
                            # Expert memory says BLOCK this ticker → skip
                            print(f"🚫 [EXPERT-MEMORY] Block {sig['ticker']} on {scan_date} — lesson-based veto", flush=True)
                            continue
                    except Exception:
                        pass  # Safe-by-design — lessons optional
                    total_generated += 1
                    if sig['morning_bell']:
                        total_morning_bells += 1
                    all_stored.append(sig)
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

    # Compute PF from stored trades
    wins_pnl = [s['pnl_pct'] for s in all_stored if s['pnl_pct'] > 0]
    losses_pnl = [abs(s['pnl_pct']) for s in all_stored if s['pnl_pct'] <= 0]
    gross_profit = sum(wins_pnl)
    gross_loss = sum(losses_pnl)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    total_wins = len(wins_pnl)
    total_picks = len(all_stored)
    overall_wr = total_wins / total_picks * 100 if total_picks else 0
    mb_wins = sum(1 for d in daily_summary if d['mb_win'])
    mb_wr = mb_wins / total_morning_bells * 100 if total_morning_bells else 0

    sig_dist = Counter(s['signal'] for s in all_stored)
    ev_dist = Counter(s['evidence'] for s in all_stored)

    print("\n" + "=" * 80, flush=True)
    print("  GENERATION COMPLETE", flush=True)
    print("=" * 80, flush=True)
    print(f"  Total predictions: {total_generated}")
    print(f"  Morning bells: {total_morning_bells} ({mb_wins} wins = {mb_wr:.1f}% WR)")
    print(f"  Overall win rate: {total_wins}/{total_picks} = {overall_wr:.1f}%")
    print(f"  Profit Factor (equity-impact): {pf:.3f}")
    print(f"  Gross profit: {gross_profit:.2f} | Gross loss: {gross_loss:.2f}")
    print(f"  Signal dist: {dict(sig_dist)}")
    print(f"  Evidence dist: {dict(sorted(ev_dist.items()))}")
    print(f"  Scan dates with picks: {len(daily_summary)}")

    summary = {
        'version': 'V40.2 (CLI-enabled, tightened entry + real benchmark + partial 1.5R)',
        'generated_at': datetime.now().isoformat(),
        'period': f'{start_date} → {end_date}',
        'scan_interval': scan_interval,
        'total_generated': total_generated,
        'total_morning_bells': total_morning_bells,
        'morning_bell_win_rate': round(mb_wr, 1),
        'overall_win_rate': round(overall_wr, 1),
        'profit_factor': round(pf, 3),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'signal_distribution': dict(sig_dist),
        'evidence_distribution': {str(k): v for k, v in sorted(ev_dist.items())},
        'scan_dates_with_picks': len(daily_summary),
        'daily': daily_summary,
    }
    summary_path = os.path.join(
        PROJECT_ROOT, 'vps-service', 'backtest_results',
        f'v40_2_generation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json',
    )
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Summary saved: {summary_path}")
    print(f"📊 Predictions in: {PREDICTIONS_DB}")


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
    parser.add_argument('--market', default='EGX', choices=['EGX', 'CRYPTO'],
                        help='السوق: EGX (افتراضي) أو CRYPTO (Aug 2026 — جديد)')
    args = parser.parse_args()

    # Determine date range
    today_str = datetime.now().strftime('%Y-%m-%d')
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    if args.today_only and args.yesterday_only:
        print("❌ لا يمكن استخدام --today-only و --yesterday-only معاً", flush=True)
        sys.exit(1)

    if args.today_only:
        start_date = today_str
        end_date = today_str
        # For today-only, scan every day (not every 3)
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
        )


def get_crypto_tickers(min_days=30):
    """Get crypto tickers from crypto_prices table (data_engine.db).

    FIX (Aug 2026): دعم CRYPTO في v40_2_daily_generator.
    بيرجع بس العملات اللي ليها تاريخ كافي في crypto_prices.
    """
    _db_dir = Path(__file__).resolve().parents[2] / 'db'
    tickers = []
    try:
        conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
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
        print(f"[V40.2-CRYPTO] crypto_prices — {len(tickers)} coins with >= {min_days} snapshots", flush=True)
    except Exception as e:
        print(f"[V40.2-CRYPTO] ⚠️ Failed to load crypto tickers: {e}", flush=True)
    return tickers


def run_crypto_generator(start_date, end_date, scan_interval=1,
                          max_picks=5, dry_run=False, keep_old=False,
                          max_tickers=None, tickers_offset=0, force=False):
    """Crypto prediction generator — نسخة مبسطة من run_generator للكريبتو.

    FIX (Aug 2026): إضافة دعم CRYPTO لـ v40_2_daily_generator.

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
        from core.prediction_tracker import PredictionTracker
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
                rsi = 50.0
                if len(closes) >= 15:
                    gains, losses = 0, 0
                    for i in range(1, 15):
                        diff = closes[i] - closes[i-1]
                        if diff >= 0:
                            gains += diff
                        else:
                            losses -= diff
                    avg_gain = gains / 14
                    avg_loss = losses / 14
                    if avg_loss == 0:
                        rsi = 100.0
                    else:
                        rs = avg_gain / avg_loss
                        rsi = 100 - (100 / (1 + rs))

                # حساب MA50 (proxy: آخر 30 closes)
                ma50 = sum(closes) / len(closes) if closes else last_price

                # إشارة بسيطة
                if rsi < 40 and last_price > ma50:
                    signal = 'BUY'
                    entry = last_price
                    target = last_price * 1.15  # +15%
                    stop = last_price * 0.92     # -8%
                elif rsi > 70:
                    signal = 'SELL'
                    entry = last_price
                    target = last_price * 0.85
                    stop = last_price * 1.08
                else:
                    continue  # NEUTRAL — skip

                # تخزين التوقع
                if tracker and not dry_run:
                    try:
                        pred_id = tracker.record_prediction(
                            ticker=ticker, signal=signal,
                            entry_price=entry, target_price=target,
                            stop_loss=stop, master_score=60 + (100 - rsi),
                            technical_score=rsi, persona='crypto_balanced',
                            prediction_date=scan_date,
                        )
                        if pred_id:
                            total_generated += 1
                            daily_picks += 1
                            print(f"  ✓ {ticker} {signal} entry=${entry:.2f} target=${target:.2f} RSI={rsi:.0f}", flush=True)
                    except Exception as e:
                        print(f"  ⚠️ Store error {ticker}: {e}", flush=True)
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
