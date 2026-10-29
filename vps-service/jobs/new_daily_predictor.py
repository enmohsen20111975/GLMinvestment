#!/usr/bin/env python3
"""
new_daily_predictor.py — التوقعات بالـ V3 المنسق/المنفذ
============================================================
بيلغي V40.2 القديم (الـ brute force) ويستخدم النظام الذكي:
  - orchestrator_v3: بيخطط مسار التحليل حسب حالة السوق
  - executor_v3: بينفذ الخطة بـ المحركات الصغيرة المتخصصة

الـ filters (من الـ smart mode):
  1. ابدأ من آخر تاريخ في الـ DB
  2. فلتر أيام الإجازات
  3. فلتر الأسهم الميتة
  4. فلتر التوقعات اللي لسه valid

Usage:
    python3 vps-service/jobs/new_daily_predictor.py --market EGX --today-only
    python3 vps-service/jobs/new_daily_predictor.py --market TADAWUL --yesterday-only
    python3 vps-service/jobs/new_daily_predictor.py --all-markets --yesterday-only
    python3 vps-service/jobs/new_daily_predictor.py --market EGX --today-only --dry-run
"""
import sys
import os
import json
import argparse
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
os.chdir(PROJECT_ROOT)

# ============================================================
# Logging — سجل مفصل لكل حاجة بتحصل
# ============================================================
LOG_DIR = PROJECT_ROOT / 'logs'
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / f'v3_predictor_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(str(LOG_FILE), encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger(__name__)
logger.info(f'=' * 60)
logger.info(f'V3 Smart Predictor started — log file: {LOG_FILE}')
logger.info(f'=' * 60)

# ============================================================
# Smart Filters (من الـ smart logic اللي اتدمج قبل كده)
# ============================================================

CANONICAL_MARKET = {
    'KSA': 'TADAWUL', 'SAUDI': 'TADAWUL', 'TADAWUL': 'TADAWUL',
    'EGX': 'EGX', 'KSE': 'KSE', 'QSE': 'QSE', 'US': 'US', 'CRYPTO': 'CRYPTO',
}

STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'

# BRAVO-DATA-LAYER (2026-10-29): V3 reads through the unified data layer.
# Owner directive: "لازم طبقة البيانات هى الى تكون شغالة مش كل ملف يقرأ ويكتب بمزاجة"
# No more direct stocks.db reads for market data. The data layer reads from
# data_engine.db (canonical source) and normalizes market slugs.
import sys as _sys
if str(PROJECT_ROOT) not in _sys.path:
    _sys.path.insert(0, str(PROJECT_ROOT))
try:
    from data_engine.data_layer import data as _data
except Exception as _e:
    _data = None
    print(f'WARN: data_layer unavailable: {_e}')


def normalize_market(market_code: str) -> str:
    return CANONICAL_MARKET.get(market_code.strip().upper(), market_code.strip().upper())


def is_trading_day(date_str: str, market_code: str) -> bool:
    try:
        from utils.trading_calendar import is_trading_day as _check
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return _check(dt, market_code)
    except Exception:
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.weekday() not in [4, 5]


def get_last_prediction_date(market_code: str) -> str | None:
    """آخر تاريخ في predictions table عبر DAL."""
    try:
        from core.db_manager import get_last_prediction_date as dal_last_date
        return dal_last_date(market_code)
    except Exception:
        return None


def get_active_tickers(market_code: str) -> list[str]:
    """كل الأسهم النشطة في السوق — BRAVO-DATA-LAYER (through data layer).

    Reads from data_engine.db.tv_snapshot (canonical source) instead of
    stocks.db.stocks. Returns tickers with current_price > 0.
    """
    if _data is None:
        # fallback to DAL if data layer unavailable
        try:
            from core.db_manager import get_active_tickers as dal_active
            return dal_active(market_code)
        except Exception:
            return []
    try:
        snaps = _data.get_market_snapshots(market_code)
        return [
            s.get('ticker')
            for s in snaps
            if s.get('ticker') and s.get('current_price') and float(s['current_price']) > 0
        ]
    except Exception:
        return []


def filter_dead_stocks(tickers: list[str], market_code: str) -> tuple[list[str], int]:
    """فلتر الأسهم الميتة عبر DAL.
    
    فلترين:
      1. الأسهم اللي price = 0 أو volume = 0 (ميتة فعلاً)
      2. الأسعار التاريخية flat (نفس السعر كل الأيام = ميت تاريخياً)
    
    STAGE-FIX (2026-10-29): قبل كده كان بيرفض أي سهم change بين -3% و +0.5%
    ده غلط — سهم طالع 0.3% أو نازل 1% مش ميت. ده بيقتل 126 سهم من 127!
    """
    if not tickers:
        return [], 0
    try:
        # BRAVO-DATA-LAYER: read snapshots through the data layer (not db_manager/stocks.db)
        # Owner: "لازم طبقة البيانات هى الى تكون شغالة"
        if _data is not None:
            all_snaps = _data.get_market_snapshots(market_code)
            snap_by_ticker = {s.get('ticker'): s for s in all_snaps}
        else:
            snap_by_ticker = {}
        alive = []
        dead_count = 0
        for ticker in tickers:
            snap = snap_by_ticker.get(ticker)
            if not snap:
                # not in tv_snapshot for this market → skip
                dead_count += 1
                continue
            price = float(snap.get('current_price') or 0)
            
            # فلتر 1: سهم ميت فعلاً (price = 0 فقط — volume ممكن يكون 0 يوم واحد)
            if price <= 0:
                dead_count += 1
                continue
            
            # فلتر 2: اتأكد إن الأسعار التاريخية مش flat
            # STAGE-FIX: خفّض من <=2 لـ <=1 (لو فيه سعرين مختلفين → مش flat)
            try:
                prices, vols, _, _, _ = get_price_history(ticker, market_code, 30)
                if prices and len(set(prices)) <= 1:
                    dead_count += 1
                    continue
            except Exception:
                pass  # لو مفيش بيانات → خليه يعدي (يتم فحصه في V3)
            
            alive.append(ticker)
        return alive, dead_count
    except Exception:
        return tickers, 0


def filter_stale_predictions(tickers: list[str], market_code: str, scan_date: str) -> tuple[list[str], int]:
    """skip لو فيه توقع نشط + السعر ما تغيرش >1% عبر DAL."""
    if not tickers:
        return [], 0
    try:
        from core.db_manager import db_manager
        # الأسهم اللي ليها توقعات نشطة في اليوم ده
        existing_rows = db_manager.query('predictions',
            """SELECT ticker, entry_price FROM predictions 
               WHERE market = ? AND prediction_date LIKE ? 
               AND (outcome_date IS NULL OR exit_type IS NULL)""",
            (market_code, f"{scan_date}%")
        )
        # الأسعار الحالية — BRAVO-DATA-LAYER (read through data layer)
        if _data is not None:
            all_snaps = _data.get_market_snapshots(market_code)
            current_prices = {s.get('ticker'): s.get('current_price') for s in all_snaps if s.get('current_price')}
        else:
            current_prices = {}
        existing_map = {r['ticker']: r['entry_price'] for r in existing_rows}
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


def get_price_history(ticker: str, market_code: str, days: int = 60) -> tuple[list, list, list, list, list]:
    """جيب آخر N يوم من الأسعار والأحجام + OHLC.

    BRAVO-DATA-LAYER (2026-10-29): reads through the unified data layer.
    Owner directive: "لازم طبقة البيانات هى الى تكون شغالة مش كل ملف يقرأ ويكتب بمزاجة"
    The data layer merges historical_data + egksco_price_history + tv_snapshot
    (today's fresh close) → clean, non-flat, time-series OHLCV.
    No more direct stocks.db reads. No more flat-data workaround.

    Returns:
        (closes, volumes, highs, lows, opens) — كلهم list[float]
    """
    if _data is None:
        logger.warning(f'data_layer unavailable — get_price_history({ticker}) empty')
        return [], [], [], [], []
    try:
        closes, volumes, highs, lows, opens = _data.get_history_lists(
            ticker, days=days, market=market_code
        )
        return closes, volumes, highs, lows, opens
    except Exception as e:
        logger.warning(f'get_price_history failed for {ticker}: {e}')
        return [], [], [], [], []


# ============================================================
# V3 Engine Runner
# ============================================================

def analyze_with_v3(ticker: str, market_code: str, prices: list[float], volumes: list[float],
                     highs: list[float] = None, lows: list[float] = None, opens: list[float] = None,
                     market_cap: float = None, free_float: float = None) -> dict:
    """
    حلل سهم بـ النظام الذكي V3 (orchestrator + executor).
    
    Args:
        highs/lows/opens: OHLC data للـ money_flow + breakout body
        market_cap: القيمة السوقية للـ liquidity_intensity
        free_float: النسبة الحرة للـ position sizing
    """
    logger.info(f'--- {ticker} ({market_code}) — V3 Analysis Start ---')
    logger.info(f'  input: {len(prices)} prices, {len(volumes)} volumes')
    if prices:
        logger.info(f'  price range: {min(prices):.2f} → {max(prices):.2f} (current={prices[-1]:.2f})')
    
    try:
        from core.orchestrator_v3 import create_v3_plan
        from core.executor_v3 import execute_v3
        
        # 1. المنسّق: يخطط التحليل
        logger.info(f'  [orchestrator] creating plan...')
        plan = create_v3_plan(
            ticker=ticker,
            prices=prices,
            volumes=volumes,
            market=market_code,
            fund_available=True,
            event_available=False,
        )
        logger.info(f'  [orchestrator] state_code={plan.state_code} | market_regime={plan.market_regime} | stock_regime={plan.stock_regime}')
        logger.info(f'  [orchestrator] selected_engines={plan.selected_engines}')
        logger.info(f'  [orchestrator] execution_order={plan.execution_order}')
        logger.info(f'  [orchestrator] normalized_weights={plan.normalized_weights}')
        logger.info(f'  [orchestrator] decision_policy={plan.decision_policy}')
        if plan.no_trade_reason:
            logger.info(f'  [orchestrator] no_trade_reason={plan.no_trade_reason}')
        
        # Gate: لو no_trade من البداية
        if plan.decision_policy == 'no_trade':
            logger.warning(f'  {ticker}: NO_TRADE (orchestrator) — {plan.no_trade_reason}')
            return {
                'ticker': ticker,
                'signal': 'NO_TRADE',
                'reason': plan.no_trade_reason,
                'state': plan.state_code,
                'complete': False,
            }
        
        # 2. المنفّذ: ينفذ الخطة
        logger.info(f'  [executor] executing plan (id={plan.plan_id[:8]})...')
        result = execute_v3(plan, prices=prices, volumes=volumes, ticker=ticker, market=market_code,
                            highs=highs, lows=lows, opens=opens,
                            market_cap=market_cap, free_float=free_float)
        
        logger.info(f'  [executor] complete={result.complete}')
        logger.info(f'  [executor] final_signal={result.final_signal}')
        logger.info(f'  [executor] signal_score={result.signal_score}')
        logger.info(f'  [executor] confidence={result.confidence}')
        logger.info(f'  [executor] position_size={result.position_size_pct}%')
        logger.info(f'  [executor] engine_scores={result.engine_scores}')
        logger.info(f'  [executor] engine_signals={result.engine_signals}')
        if result.warnings:
            logger.warning(f'  [executor] warnings={result.warnings[:5]}')
        if result.errors:
            logger.error(f'  [executor] errors={result.errors[:5]}')
        if result.no_trade_reason:
            logger.info(f'  [executor] no_trade_reason={result.no_trade_reason}')
        
        return {
            'ticker': ticker,
            'signal': result.final_signal,
            'confidence': result.confidence,
            'score': result.signal_score,
            'state': plan.state_code,
            'market_regime': plan.market_regime,
            'engines_ran': list(result.engine_scores.keys()),
            'risk_profile': result.risk_profile,
            'position_size': result.position_size_pct,
            'warnings': result.warnings[:3] if isinstance(result.warnings, list) else [],
            'errors': result.errors[:3] if isinstance(result.errors, list) else [],
            'complete': result.complete,
            'no_trade_reason': result.no_trade_reason,
        }
    except Exception as e:
        logger.error(f'  {ticker}: EXCEPTION — {e}', exc_info=True)
        return {
            'ticker': ticker,
            'signal': 'ERROR',
            'reason': str(e)[:200],
            'complete': False,
        }


def save_prediction(result: dict, market_code: str, scan_date: str) -> bool:
    """احفظ التوقع في predictions.db.

    BRAVO-SAVE-FIX (2026-10-29):
    - WAL mode + short busy_timeout (5s) + retry (3x) على 'database is locked'
    - CAST صريح لـ id كـ TEXT (fix datatype mismatch لو الـ schema قديم)
    - connection بتـ close في finally (مش بس في success path)
    - لو الـ id column مش TEXT → ALTER + recreate index
    """
    if result.get('signal') not in ['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL']:
        logger.info(f'  {result["ticker"]}: save skipped (signal={result.get("signal")})')
        return False

    import sqlite3 as _sql
    import uuid as _uuid
    import time as _time
    _db_path = str(PROJECT_ROOT / 'db' / 'predictions.db')

    conn = None
    try:
        conn = _sql.connect(_db_path, timeout=5.0, isolation_level=None)  # autocommit mode
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=5000')
        conn.execute('PRAGMA synchronous=NORMAL')

        # تأكد إن جدول predictions موجود
        # BRAVO-API-COMPAT: schema كامل يطابق ما الـ Next.js API بـ يتوقعه
        # (target_price_2, exit_price, actual_return, hit_target, hit_stop,
        #  is_correct, holding_days, lifecycle_status, outcome_date, analysis_json, etc)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS predictions (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                signal TEXT,
                signal_type TEXT,
                prediction_date TEXT,
                entry_price REAL,
                target_price REAL,
                target_price_2 REAL,
                stop_loss REAL,
                master_score REAL,
                confidence REAL,
                persona TEXT DEFAULT 'balanced',
                status TEXT DEFAULT 'active',
                outcome_date TEXT,
                exit_price REAL,
                actual_return REAL,
                hit_target INTEGER DEFAULT 0,
                hit_stop INTEGER DEFAULT 0,
                is_correct INTEGER,
                holding_days INTEGER,
                lifecycle_status TEXT,
                created_at TEXT,
                notes TEXT,
                analysis_json TEXT
            )
        ''')

        # BRAVO-API-COMPAT: ALTER لإضافة أي أعمدة ناقصة (للـ tables القديمة)
        # ده idempotent — بـ يتخطى الأعمدة الموجودة
        existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()}
        required_extra_cols = {
            'target_price_2': 'REAL',
            'outcome_date': 'TEXT',
            'exit_price': 'REAL',
            'actual_return': 'REAL',
            'hit_target': 'INTEGER DEFAULT 0',
            'hit_stop': 'INTEGER DEFAULT 0',
            'is_correct': 'INTEGER',
            'holding_days': 'INTEGER',
            'lifecycle_status': 'TEXT',
            'analysis_json': 'TEXT',
        }
        for col, typ in required_extra_cols.items():
            if col not in existing_cols:
                try:
                    conn.execute(f'ALTER TABLE predictions ADD COLUMN "{col}" {typ}')
                    existing_cols.add(col)
                except Exception:
                    pass

        # BRAVO-SAVE-FIX: لو الـ id column مش TEXT → نـ recreate الـ table بـ TEXT
        # (SQLite مش بـ يدعم ALTER COLUMN type، فـ لازم recreate)
        id_col_info = conn.execute("PRAGMA table_info(predictions)").fetchall()
        id_col = next((r for r in id_col_info if r[1] == 'id'), None)
        if id_col and id_col[2].upper() != 'TEXT':
            logger.warning(f'  predictions.id is {id_col[2]} (not TEXT) — recreating table to fix datatype mismatch')
            # backup existing data
            try:
                conn.execute('ALTER TABLE predictions RENAME TO predictions_old_intid')
                conn.execute('''
                    CREATE TABLE predictions (
                        id TEXT PRIMARY KEY,
                        ticker TEXT NOT NULL,
                        market TEXT DEFAULT 'EGX',
                        signal TEXT,
                        signal_type TEXT,
                        prediction_date TEXT,
                        entry_price REAL,
                        target_price REAL,
                        stop_loss REAL,
                        master_score REAL,
                        confidence REAL,
                        persona TEXT DEFAULT 'balanced',
                        status TEXT DEFAULT 'active',
                        created_at TEXT,
                        notes TEXT
                    )
                ''')
                # BRAVO-COPY-FIX: copy only columns that exist in BOTH tables (intersection)
                # هذا يمنع فشل النسخ إذا كان الجدول القديم يحتوي على أعمدة إضافية (مثل technical_score)
                cols_old = [r[1] for r in conn.execute("PRAGMA table_info(predictions_old_intid)").fetchall()]
                cols_new = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
                cols_new_set = set(cols_new)
                # intersection: columns that exist in both old and new
                common_cols = [c for c in cols_old if c in cols_new_set]
                if common_cols:
                    cols_str = ", ".join('"' + c + '"' for c in common_cols)
                    non_id_select = ', '.join('"' + c + '"' for c in common_cols if c != 'id')
                    select_clause = 'CAST("id" AS TEXT) as "id"'
                    if non_id_select:
                        select_clause += ', ' + non_id_select
                    try:
                        copy_sql = 'INSERT OR IGNORE INTO predictions (' + cols_str + ') SELECT ' + select_clause + ' FROM predictions_old_intid'
                        cur_copy = conn.execute(copy_sql)
                        copied = cur_copy.rowcount
                        logger.info(f'  ✓ copied {copied} old predictions to new table')
                    except Exception as copy_e:
                        logger.warning(f'  copy old data failed (continuing): {copy_e}')
                else:
                    logger.warning(f'  no common columns between old and new predictions table — skipping copy')
                conn.execute('DROP TABLE predictions_old_intid')
                logger.info(f'  ✓ predictions table recreated with TEXT id')
            except Exception as recreate_e:
                logger.error(f'  recreate table failed: {recreate_e}')

        # خد السعر الحالي — BRAVO-DATA-LAYER (read through data layer, not stocks.db)
        entry_price = 0.0
        if _data is not None:
            _snap = _data.get_snapshot(result['ticker'])
            if _snap and _snap.get('current_price'):
                try:
                    entry_price = float(_snap['current_price'])
                except (ValueError, TypeError):
                    entry_price = 0.0
        confidence = float(result.get('confidence', 0) or 0)
        score = float(result.get('score', 0) or 0)
        _confidence = confidence
        _score = score

        # احسب target/stop بسيط
        signal = str(result['signal'])
        if 'BUY' in signal:
            target_price = entry_price * 1.05 if entry_price > 0 else 0.0
            stop_loss = entry_price * 0.97 if entry_price > 0 else 0.0
        else:
            target_price = entry_price * 0.95 if entry_price > 0 else 0.0
            stop_loss = entry_price * 1.03 if entry_price > 0 else 0.0

        # BRAVO-SAVE-FIX: cast id صراحة لـ str + أعرّف كل القيم كـ types صحيحة
        _pred_id = str(_uuid.uuid4())[:16]
        _ticker = str(result['ticker'])
        _market = str(market_code)
        _signal = str(result['signal'])
        _signal_type = str(_signal)
        _scan_date = str(scan_date)
        _entry_price = float(entry_price)
        _target_price = float(target_price)
        _stop_loss = float(stop_loss)
        _created_at = str(datetime.now().isoformat())
        _notes = str(f"state={result.get('state','?')} regime={result.get('market_regime','?')} engines={result.get('engines_ran',[])}")

        # retry على 'database is locked' (3x مع backoff)
        # BRAVO-PERSONA-FIX: persona='balanced' (مش 'v3_smart') عشان الـ frontend
        # بـ يـ filter بـ WHERE persona='balanced' → لو حطينا 'v3_smart' مش هيتشاف.
        _persona_val = 'balanced'
        max_retries = 3
        last_err = None
        _saved_to_predictions = False
        for attempt in range(max_retries):
            try:
                conn.execute("""
                    INSERT INTO predictions (id, ticker, market, signal, signal_type,
                                            prediction_date, entry_price, target_price, stop_loss,
                                            master_score, confidence, persona, status, created_at, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
                """, (
                    _pred_id, _ticker, _market, _signal, _signal_type,
                    _scan_date, _entry_price, _target_price, _stop_loss,
                    _score, _confidence, _persona_val, _created_at, _notes
                ))
                _saved_to_predictions = True
                break  # success → exit retry loop
            except _sql.OperationalError as oe:
                if 'locked' in str(oe).lower() and attempt < max_retries - 1:
                    _time.sleep(0.5 * (attempt + 1))  # 0.5s, 1s, 1.5s
                    last_err = oe
                    continue
                raise  # re-raise on last attempt or non-lock OperationalError
            except _sql.IntegrityError as ie:
                # 'datatype mismatch' — محاولة إصلاح بـ CAST صريح
                if 'datatype mismatch' in str(ie).lower():
                    logger.warning(f'  {result["ticker"]}: datatype mismatch — trying with CAST(id AS TEXT)')
                    try:
                        conn.execute("""
                            INSERT INTO predictions (id, ticker, market, signal, signal_type,
                                                    prediction_date, entry_price, target_price, stop_loss,
                                                    master_score, confidence, persona, status, created_at, notes)
                            VALUES (CAST(? AS TEXT), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
                        """, (
                            _pred_id, _ticker, _market, _signal, _signal_type,
                            _scan_date, _entry_price, _target_price, _stop_loss,
                            _score, _confidence, _persona_val, _created_at, _notes
                        ))
                        _saved_to_predictions = True
                        break
                    except Exception as e2:
                        logger.error(f'  {result["ticker"]}: ✗ CAST retry failed — {e2}')
                        return False
                raise

        if not _saved_to_predictions:
            if last_err:
                raise last_err
            return False

        logger.info(f'  {result["ticker"]}: ✓ saved to predictions.db (id={_pred_id})')

        # BRAVO-STORED-ANALYSES: احفظ نسخة في stored_analyses (الـ frontend بـ يقرا منها أساساً)
        # لو مش موجودين → الـ frontend بـ يـ show "محرك المتوازن يبحث عن فرص" (فاضي).
        # الـ stored_analyses table لها schema مختلفة:
        #   - recommendation بدل signal
        #   - maestro_score بدل master_score
        # بنكتب بس الأعمدة الموجودة (idempotent + defensive).
        try:
            sa_cols = {r[1] for r in conn.execute("PRAGMA table_info(stored_analyses)").fetchall()}
            if sa_cols:
                sa_vals = {}
                if 'ticker' in sa_cols: sa_vals['ticker'] = _ticker
                if 'market' in sa_cols: sa_vals['market'] = _market
                if 'maestro_score' in sa_cols: sa_vals['maestro_score'] = _score
                if 'recommendation' in sa_cols:
                    sa_vals['recommendation'] = _signal.lower() if _signal in ('BUY','STRONG_BUY','SELL','STRONG_SELL','HOLD') else 'hold'
                if 'confidence' in sa_cols: sa_vals['confidence'] = _confidence
                if 'entry_price' in sa_cols: sa_vals['entry_price'] = _entry_price
                if 'target_price' in sa_cols: sa_vals['target_price'] = _target_price
                if 'stop_loss' in sa_cols: sa_vals['stop_loss'] = _stop_loss
                if 'risk_reward' in sa_cols and _stop_loss and _entry_price and _stop_loss != _entry_price:
                    sa_vals['risk_reward'] = abs(_target_price - _entry_price) / abs(_stop_loss - _entry_price)
                if 'regime' in sa_cols: sa_vals['regime'] = str(result.get('market_regime', ''))
                if 'analysis_json' in sa_cols: sa_vals['analysis_json'] = _notes
                if 'updated_at' in sa_cols: sa_vals['updated_at'] = _created_at
                # build INSERT (id has default lower(hex(randomblob(16))))
                sa_col_list = list(sa_vals.keys())
                sa_placeholders = ', '.join(['?'] * len(sa_col_list))
                sa_col_str = ', '.join('"' + c + '"' for c in sa_col_list)
                sa_sql = f'INSERT INTO stored_analyses ({sa_col_str}) VALUES ({sa_placeholders})'
                conn.execute(sa_sql, tuple(sa_vals[c] for c in sa_col_list))
                logger.info(f'  {result["ticker"]}: ✓ also saved to stored_analyses')
        except Exception as sa_e:
            # مش fatal — الـ prediction اتـ save في predictions table بالفعل
            logger.warning(f'  {result["ticker"]}: stored_analyses insert skipped: {sa_e}')

        return True
    except Exception as e:
        logger.error(f'  {result["ticker"]}: ✗ save failed — {e}')
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ============================================================
# Main Runner
# ============================================================

def run(market_code: str, start_date: str | None = None, end_date: str | None = None,
        dry_run: bool = False, max_tickers: int | None = None):
    """شغّل الـ V3 predictor لسوق معين."""
    canonical = normalize_market(market_code)
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    # 1. حدد نطاق التواريخ
    if start_date is None:
        last_date = get_last_prediction_date(canonical)
        if last_date:
            last_dt = datetime.strptime(last_date, '%Y-%m-%d')
            start_date = (last_dt + timedelta(days=1)).strftime('%Y-%m-%d')
            print(f"  📅 آخر توقع: {last_date} → نبدأ من {start_date}", flush=True)
        else:
            start_date = yesterday
            print(f"  📅 مفيش توقعات قديمة → نبدأ من {start_date}", flush=True)
    if end_date is None:
        end_date = today
    
    print(f"\n{'='*60}", flush=True)
    print(f"  V3 Smart Predictor — {canonical}", flush=True)
    print(f"  Period: {start_date} → {end_date}", flush=True)
    print(f"  Dry-run: {dry_run}", flush=True)
    print(f"{'='*60}\n", flush=True)
    
    # 2. فلتر أيام الإجازات
    start_dt = datetime.strptime(start_date, '%Y-%m-%d')
    end_dt = datetime.strptime(end_date, '%Y-%m-%d')
    all_dates = []
    current = start_dt
    while current <= end_dt:
        all_dates.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    
    scan_dates = [d for d in all_dates if is_trading_day(d, canonical)]
    print(f"  📅 إجمالي: {len(all_dates)} | بعد فلتر الإجازات: {len(scan_dates)}", flush=True)
    
    if not scan_dates:
        print("  ℹ️  مفيش أيام تداول", flush=True)
        return
    
    # 3. الأسهم المرشحة
    candidate_tickers = get_active_tickers(canonical)
    if not candidate_tickers:
        print("  ℹ️  مفيش أسهم نشطة", flush=True)
        return
    print(f"  📊 أسهم نشطة: {len(candidate_tickers)}", flush=True)
    
    # 4. لكل يوم، فلتر وحلل
    total_analyzed = 0
    total_saved = 0
    total_skipped_stale = 0
    total_skipped_dead = 0
    total_no_trade = 0
    total_errors = 0
    
    for scan_date in scan_dates:
        print(f"\n  📅 {scan_date}:", flush=True)
        
        # 4a. فلتر التوقعات اللي لسه valid
        todo, skipped_stale = filter_stale_predictions(candidate_tickers, canonical, scan_date)
        total_skipped_stale += skipped_stale
        
        # 4b. فلتر الأسهم الميتة
        alive, dead_count = filter_dead_stocks(todo, canonical)
        total_skipped_dead += dead_count
        print(f"    - after filters: {len(alive)} (skip stale={skipped_stale}, dead={dead_count})", flush=True)
        
        if not alive:
            print(f"    ℹ️  مفيش أسهم تستاهل", flush=True)
            continue
        
        # 4c. limit
        if max_tickers and len(alive) > max_tickers:
            alive = alive[:max_tickers]
        
        # 5. حلل بـ V3
        _signals_today = []  # STAGE-5: للـ ranking
        for ticker in alive:
            prices, volumes, highs, lows, opens = get_price_history(ticker, canonical)
            if len(prices) < 20:
                continue  # V3 محتاج على الأقل 20 يوم (خفّضنا من 50)
            
            # STAGE-1: اقرأ market_cap + free_float — BRAVO-DATA-LAYER (through data layer)
            _mc = None
            _ff = None
            try:
                if _data is not None:
                    _snap = _data.get_snapshot(ticker)
                    if _snap:
                        _mc_val = _snap.get('market_cap')
                        if _mc_val:
                            try:
                                _mc = float(_mc_val) or None
                            except (ValueError, TypeError):
                                _mc = None
                        # free_float not in TV snapshot — leave None (V3 handles it)
            except Exception:
                pass
            
            result = analyze_with_v3(ticker, canonical, prices, volumes,
                                      highs=highs, lows=lows, opens=opens,
                                      market_cap=_mc, free_float=_ff)
            total_analyzed += 1
            
            signal = result.get('signal', 'NO_TRADE')
            state = result.get('state', '?')
            
            if signal == 'NO_TRADE':
                total_no_trade += 1
                print(f"    {ticker}: NO_TRADE (state={state}, reason={result.get('no_trade_reason','?')[:50]})", flush=True)
            elif signal == 'ERROR':
                total_errors += 1
                print(f"    {ticker}: ERROR — {result.get('reason','?')[:80]}", flush=True)
            else:
                # BUY / SELL — جمع للـ ranking
                _signals_today.append({
                    'ticker': ticker,
                    'result': result,
                    'market_cap': _mc,
                    'free_float': _ff,
                    'score': result.get('score', 0),
                    'confidence': result.get('confidence', 0),
                })
        
        # STAGE-5: Ranking — رتّب الإشارات واختار أعلى max_picks
        _max_picks = max_tickers or 50  # default 50 لو مش محدد
        if _signals_today:
            # احسب rank_score لكل إشارة
            for sig in _signals_today:
                _score_norm = max(0, min(100, (sig['score'] + 100) / 2))  # -100..100 → 0..100
                _conf_norm = sig['confidence']  # 0..100
                _mc = sig.get('market_cap') or 0
                _vol = 0
                try:
                    _prices, _vols, _, _, _ = get_price_history(sig['ticker'], canonical, 5)
                    _vol = _vols[-1] if _vols else 0
                except: pass
                _turnover = _vol * (_prices[-1] if _prices else 0)
                _intensity = (_turnover / _mc * 100) if _mc and _mc > 0 and _turnover > 0 else 0
                _intensity_norm = min(100, _intensity / 0.5 * 100)  # 0.5% = 100
                
                # STAGE-5 FIX: شيل التكرار — استخدم RS + flow_quality حقيقيين
                _rs_score = 50  # default neutral
                try:
                    _sma20 = sum(_prices[-20:]) / 20 if len(_prices) >= 20 else last_price
                    _rs_score = max(0, min(100, ((last_price - _sma20) / _sma20 * 100 + 5) * 10))
                except: pass
                _flow_quality = _conf_norm  # proxy: confidence = agreement = flow quality
                
                sig['rank_score'] = (
                    _score_norm * 0.45 +        # signal score
                    _conf_norm * 0.25 +          # confidence
                    _intensity_norm * 0.15 +     # liquidity intensity
                    _rs_score * 0.10 +           # RS (سعر vs SMA20)
                    _flow_quality * 0.05          # flow quality (confidence proxy)
                )
            
            # رتّب تنازليًا
            _signals_today.sort(key=lambda x: x['rank_score'], reverse=True)
            
            # خد أعلى max_picks بس
            _selected = _signals_today[:_max_picks]
            _rejected = _signals_today[_max_picks:]
            
            for sig in _selected:
                ticker = sig['ticker']
                result = sig['result']
                state = result.get('state', '?')
                logger.info(f'  {ticker}: {result["signal"]} ✓ (rank={sig["rank_score"]:.1f}, state={state}, score={result.get("score",0):.1f}, conf={result.get("confidence",0):.1f})')
                if not dry_run:
                    saved = save_prediction(result, canonical, scan_date)
                    if saved:
                        total_saved += 1
                print(f"    {ticker}: {result['signal']} ✓ (rank={sig['rank_score']:.1f}, state={state}, score={result.get('score',0):.1f}, conf={result.get('confidence',0):.1f})", flush=True)
            
            # الباقي → NO_TRADE
            for sig in _rejected:
                total_no_trade += 1
                print(f"    {sig['ticker']}: NO_TRADE (rank={sig['rank_score']:.1f} — below max_picks={_max_picks})", flush=True)
    
    # 6. ملخص
    summary = {
        'market': canonical,
        'scan_dates_count': len(scan_dates),
        'total_analyzed': total_analyzed,
        'total_saved': total_saved,
        'total_no_trade': total_no_trade,
        'total_errors': total_errors,
        'skipped_stale': total_skipped_stale,
        'skipped_dead': total_skipped_dead,
        'timestamp': datetime.now().isoformat(),
    }
    print(f"\n{'='*60}", flush=True)
    print(f"  ✅ الملخص — {canonical}", flush=True)
    print(f"    - أيام التداول: {len(scan_dates)}", flush=True)
    print(f"    - أسهم تحللت: {total_analyzed}", flush=True)
    print(f"    - توقعات محفوظة: {total_saved}", flush=True)
    print(f"    - NO_TRADE: {total_no_trade}", flush=True)
    print(f"    - errors: {total_errors}", flush=True)
    print(f"    - تخطى (stale): {total_skipped_stale}", flush=True)
    print(f"    - تخطى (dead): {total_skipped_dead}", flush=True)
    print(f"{'='*60}", flush=True)
    
    # سجل الملخص في الـ log file
    logger.info(f'=' * 60)
    logger.info(f'SUMMARY — {canonical}')
    for k, v in summary.items():
        logger.info(f'  {k}: {v}')
    logger.info(f'=' * 60)
    logger.info(f'Log file saved to: {LOG_FILE}')
    
    # احفظ الملخص في ملف JSON كمان
    summary_file = LOG_DIR / f'v3_summary_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    logger.info(f'Summary JSON saved to: {summary_file}')


def main():
    parser = argparse.ArgumentParser(description='V3 Smart Predictor — التوقعات بالـ orchestrator/executor')
    parser.add_argument('--market', default='EGX', choices=['EGX','KSA','TADAWUL','KSE','QSE','US'])
    parser.add_argument('--all-markets', action='store_true')
    parser.add_argument('--today-only', action='store_true')
    parser.add_argument('--yesterday-only', action='store_true')
    parser.add_argument('--start', default=None)
    parser.add_argument('--end', default=None)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--max-tickers', type=int, default=None)
    args = parser.parse_args()
    
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    start_date = args.start
    end_date = args.end
    if args.today_only:
        start_date = end_date = today
    elif args.yesterday_only:
        start_date = end_date = yesterday
    
    if args.all_markets:
        for m in ['EGX','KSA','KSE','QSE']:
            print(f"\n{'#'*60}\n# {m}\n{'#'*60}", flush=True)
            run(m, start_date, end_date, args.dry_run, args.max_tickers)
    else:
        run(args.market, start_date, end_date, args.dry_run, args.max_tickers)


if __name__ == '__main__':
    main()
